import { CronJob } from "cron";
import { database, SchedulerRow, ChannelSessionRow, channelThreadId } from "../Core/Database";
import { sessionManager } from "../Session/SessionManager";
import { LoggerService } from "../Core/LoggerService";
import { config } from "../Core/Config";
import { channelManager } from "../Channel/ChannelManager";

const logger = LoggerService.getLogger("SchedulerService.ts");

async function executeScheduler(schedulerId: number): Promise<void> {
    const scheduler = await database.findByPk<SchedulerRow>(database.scheduler, schedulerId);
    if (!scheduler || scheduler.disabled) return;

    const tag = `[${scheduler.id}]`;

    try {
        const sessionRow = scheduler.targetId
            ? await database.findByPk<ChannelSessionRow>(database.channelSession, parseInt(scheduler.targetId))
            : null;

        if (!sessionRow) {
            logger.error(`Scheduler task ${tag}: targetId=${scheduler.targetId} not found`);
            return;
        }

        const { channelId, sessionId, id: dbSessionId } = sessionRow;
        const channelConfig = config.getChannel(channelId);
        const channelType = channelConfig?.type;
        if (!channelType) {
            logger.warn(`Scheduler task ${tag} unknown channel type for channelId=${channelId}`);
            return;
        }

        if (scheduler.aiProcess) {
            if (channelId === 'web') {
                const threadId = channelThreadId(channelType, channelId, sessionId);
                await sessionManager.onReceiveWebMessage(threadId, scheduler.message, sessionId, dbSessionId);
            } else {
                const threadId = channelThreadId(channelType, channelId, sessionId);
                await sessionManager.onReceiveChannelMessage(threadId, scheduler.message, {
                    channelType,
                    channelId,
                    dbSessionId,
                    sessionId,
                });
            }
        } else {
            if (channelId === 'web') {
                logger.warn(`Scheduler task ${tag} non-aiProcess for web channel is not supported`);
            } else {
                await channelManager.sendText(channelId, sessionId, scheduler.message);
            }
        }
        logger.info(`Scheduler task ${tag} fired (${channelType}), session ${sessionId}, aiProcess=${scheduler.aiProcess}`);
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
    private jobs = new Map<number, CronJob>();

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

    /** 调度单个任务，返回 true 表示成功调度 */
    private async schedule(scheduler: SchedulerRow): Promise<boolean> {
        this.cancel(scheduler.id);

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
            this.jobs.set(scheduler.id, job);
            const nextRun = job.nextDate().toMillis();
            await database.update(database.scheduler, { nextRun }, { where: { id: scheduler.id } });
            logger.info(`Scheduler task [${scheduler.id}] started (${scheduler.expr}), next run: ${job.nextDate().toISO()}`);
            return true;
        } catch (e: any) {
            logger.error(`Scheduler task [${scheduler.id}] scheduling failed: ${e?.message}`);
            return false;
        }
    }

    /** Returns the next scheduled timestamp (ms) for a scheduler, or null if not scheduled */
    nextDate(schedulerId: number): number | null {
        const job = this.jobs.get(schedulerId);
        if (!job) return null;
        try { return job.nextDate().toMillis(); } catch { return null; }
    }

    /** 停止并移除 cron job（不操作数据库） */
    private cancel(schedulerId: number): void {
        const job = this.jobs.get(schedulerId);
        if (job) {
            job.stop();
            this.jobs.delete(schedulerId);
        }
    }

    /** 停止所有 cron job */
    stopAll(): void {
        for (const [id, job] of this.jobs) {
            job.stop();
        }
        this.jobs.clear();
    }

    /** 取消调度并标记为禁用（软删除） */
    async delete(schedulerId: number): Promise<void> {
        this.cancel(schedulerId);
        await database.update(database.scheduler, { disabled: true }, { where: { id: schedulerId } });
    }

    /** 重新从 DB 加载并重新调度（外部增删改后调用） */
    async reload(schedulerId: number): Promise<void> {
        const scheduler = await database.findByPk<SchedulerRow>(database.scheduler, schedulerId);
        if (scheduler) await this.schedule(scheduler);
        else this.cancel(schedulerId);
    }
}

export const schedulerService = new SchedulerService();
