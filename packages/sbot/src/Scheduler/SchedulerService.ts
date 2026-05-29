import { CronJob } from "cron";
import { database, SchedulerRow } from "../Core/Database";
import { LoggerService } from "../Core/LoggerService";
import { TimerExecutor } from "../Core/TimerExecutor";
import { dispatchToSession } from "../Core/dispatchToSession";

const logger = LoggerService.getLogger("SchedulerService.ts");

async function executeScheduler(schedulerId: number): Promise<void> {
    const scheduler = await database.findByPk<SchedulerRow>(database.scheduler, schedulerId);
    if (!scheduler || scheduler.disabled) return;

    const tag = `[${scheduler.id}]`;

    try {
        const result = await dispatchToSession({
            targetId: scheduler.targetId,
            message: scheduler.message,
            aiProcess: scheduler.aiProcess,
            tag: `Scheduler task ${tag}`,
        });
        if (result.ok) {
            logger.info(`Scheduler task ${tag} fired (${result.channelType}), session ${result.sessionId}, aiProcess=${scheduler.aiProcess}`);
        }
    } catch (e: any) {
        logger.error(`Scheduler task ${tag} failed: ${e?.message ?? e}`);
    }

    const newRunCount = (scheduler.runCount ?? 0) + 1;

    if (scheduler.maxRuns > 0 && newRunCount >= scheduler.maxRuns) {
        logger.info(`Scheduler task ${tag} reached maxRuns (${scheduler.maxRuns}), deleting`);
        await schedulerService.delete(scheduler.id);
    } else {
        const nextRun = schedulerService.nextDate(scheduler.id);
        await database.update(database.scheduler, { lastRun: Date.now(), runCount: newRunCount, nextRun }, { where: { id: scheduler.id } });
    }
}

class SchedulerService {
    private executor = new TimerExecutor<CronJob>({ name: "Scheduler", stop: job => job.stop() });

    async start(): Promise<void> {
        const schedulers = await database.findAll<SchedulerRow>(database.scheduler, {
            where: { disabled: false },
        });
        let loaded = 0;
        const now = Date.now();
        for (const scheduler of schedulers) {
            if (await this.schedule(scheduler)) {
                loaded++;
                if (scheduler.nextRun && scheduler.nextRun <= now) {
                    logger.info(`Scheduler task [${scheduler.id}] missed execution detected on startup (nextRun=${new Date(scheduler.nextRun).toISOString()}), running immediately`);
                    executeScheduler(scheduler.id);
                }
            }
        }
    }

    private async schedule(scheduler: SchedulerRow): Promise<boolean> {
        this.executor.cancel(scheduler.id);

        if (!scheduler.expr?.trim()) {
            logger.error(`Scheduler task [${scheduler.id}] cron expression is empty, skipping`);
            return false;
        }

        if (scheduler.disabled) {
            logger.info(`Scheduler task [${scheduler.id}] is disabled, skipping`);
            return false;
        }

        if (scheduler.maxRuns > 0 && (scheduler.runCount ?? 0) >= scheduler.maxRuns) {
            logger.info(`Scheduler task [${scheduler.id}] reached max runs, disabling`);
            await database.update(database.scheduler, { disabled: true }, { where: { id: scheduler.id } });
            return false;
        }

        try {
            const job = CronJob.from({
                cronTime: scheduler.expr,
                onTick: () => executeScheduler(scheduler.id),
                start: true,
                waitForCompletion: true,
            });
            this.executor.set(scheduler.id, job);
            const nextRun = job.nextDate().toMillis();
            await database.update(database.scheduler, { nextRun }, { where: { id: scheduler.id } });
            logger.info(`Scheduler task [${scheduler.id}] started (${scheduler.expr}), next run: ${job.nextDate().toISO()}`);
            return true;
        } catch (e: any) {
            logger.error(`Scheduler task [${scheduler.id}] scheduling failed: ${e?.message}`);
            return false;
        }
    }

    nextDate(schedulerId: number): number | null {
        const job = this.executor.get(schedulerId);
        if (!job) return null;
        try { return job.nextDate().toMillis(); } catch { return null; }
    }

    stopAll(): void {
        this.executor.stopAll();
    }

    async delete(schedulerId: number): Promise<void> {
        this.executor.cancel(schedulerId);
        await database.update(database.scheduler, { disabled: true }, { where: { id: schedulerId } });
    }

    async update(schedulerId: number, patch: Partial<Pick<SchedulerRow, "message" | "targetId" | "aiProcess">>): Promise<SchedulerRow | null> {
        const fields: Partial<SchedulerRow> = {};
        if (patch.message != null)   fields.message   = patch.message;
        if (patch.targetId != null)  fields.targetId  = patch.targetId;
        if (patch.aiProcess != null) fields.aiProcess = patch.aiProcess;
        if (Object.keys(fields).length === 0) return database.findByPk<SchedulerRow>(database.scheduler, schedulerId);
        await database.update(database.scheduler, fields, { where: { id: schedulerId } });
        return database.findByPk<SchedulerRow>(database.scheduler, schedulerId);
    }

    async reload(schedulerId: number): Promise<void> {
        const scheduler = await database.findByPk<SchedulerRow>(database.scheduler, schedulerId);
        if (scheduler) await this.schedule(scheduler);
        else this.executor.cancel(schedulerId);
    }
}

export const schedulerService = new SchedulerService();
