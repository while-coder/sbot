import { CronJob } from "cron";
import { database, SchedulerRow, ChannelSessionRow, getChannelSession, getSessionProfile } from "../Core/Database";
import { LoggerService } from "../Core/LoggerService";
import { TimerExecutor } from "../Core/TimerExecutor";
import { dispatchToSession } from "../Core/dispatchToSession";

const logger = LoggerService.getLogger("SchedulerService.ts");

/**
 * 解析 scheduler 的投递目标：
 * - 优先用 scheduler.channelSessionId 指定的 session
 * - 该 session 失效（被删 / channelId 变了）时，在同 profileId 下找替代：同 channelId 优先
 * - 找到替代时回写 channelSessionId（自愈）
 * - profileId 不存在 / profile 下无任何 session：返回 null，调用方按 error 处理
 */
async function resolveDeliverySession(scheduler: SchedulerRow): Promise<ChannelSessionRow | null> {
    const profileId = scheduler.profileId;
    if (!profileId || profileId <= 0) return null;
    const profile = await getSessionProfile(profileId);
    if (!profile) return null;

    const tag = `[${scheduler.id}]`;
    const primary = scheduler.channelSessionId > 0
        ? await getChannelSession(scheduler.channelSessionId)
        : null;
    if (primary && primary.profileId === profileId) return primary;

    // 失效，按 profileId 找候选（同 channelId 优先）
    const candidates = await database.findAll<ChannelSessionRow>(database.channelSession, { where: { profileId } });
    if (candidates.length === 0) {
        logger.warn(`Scheduler ${tag} no fallback session under profileId=${profileId}`);
        return null;
    }
    const sameChannel = primary ? candidates.find(c => c.channelId === primary.channelId) : undefined;
    const picked = sameChannel ?? candidates[0];
    const crossChannel = primary && picked.channelId !== primary.channelId;
    logger.warn(
        `Scheduler ${tag} channelSessionId self-heal: ${scheduler.channelSessionId} -> ${picked.id} `
        + `(profileId=${profileId}${crossChannel ? `, cross-channel ${primary!.channelId} -> ${picked.channelId}` : ''})`
    );
    await database.update(database.scheduler, { channelSessionId: picked.id }, { where: { id: scheduler.id } });
    scheduler.channelSessionId = picked.id;
    return picked;
}

async function executeScheduler(schedulerId: number): Promise<void> {
    const scheduler = await database.findByPk<SchedulerRow>(database.scheduler, schedulerId);
    if (!scheduler || scheduler.disabled) return;

    const tag = `[${scheduler.id}]`;

    try {
        const session = await resolveDeliverySession(scheduler);
        if (!session) {
            logger.error(`Scheduler task ${tag} aborted: profile id=${scheduler.profileId} has no usable session`);
            return;
        }
        const result = await dispatchToSession({
            targetId: session.id,
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

    async update(schedulerId: number, patch: Partial<Pick<SchedulerRow, "message" | "channelSessionId" | "aiProcess">>): Promise<SchedulerRow | null> {
        const fields: Partial<SchedulerRow> = {};
        if (patch.message != null)          fields.message          = patch.message;
        if (patch.channelSessionId != null) fields.channelSessionId = patch.channelSessionId;
        if (patch.aiProcess != null)        fields.aiProcess        = patch.aiProcess;
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
