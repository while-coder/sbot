import { CronJob } from "cron";
import { database, SchedulerRow, ChannelSessionRow } from "../Core/Database";
import { channelDataService } from "../Session/ChannelDataService";
import { LoggerService } from "../Core/LoggerService";
import { TimerExecutor } from "../Core/TimerExecutor";
import { triggerSession } from "../Core/triggerSession";

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
    const profile = await channelDataService.getProfile(profileId);
    if (!profile) return null;

    const tag = `[${scheduler.id}]`;
    const primary = scheduler.channelSessionId > 0
        ? await channelDataService.getSession(scheduler.channelSessionId)
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
    if (!scheduler || !scheduler.enabled) return;

    const tag = `[${scheduler.id}]`;

    try {
        const session = await resolveDeliverySession(scheduler);
        if (!session) {
            logger.error(`Scheduler task ${tag} aborted: profile id=${scheduler.profileId} has no usable session`);
            return;
        }
        const result = await triggerSession({
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
            where: { enabled: true },
            order: [['id', 'ASC']],
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

        if (!scheduler.enabled) {
            logger.info(`Scheduler task [${scheduler.id}] is not enabled, skipping`);
            await database.update(database.scheduler, { nextRun: null }, { where: { id: scheduler.id } });
            return false;
        }

        if (scheduler.maxRuns > 0 && (scheduler.runCount ?? 0) >= scheduler.maxRuns) {
            logger.info(`Scheduler task [${scheduler.id}] reached max runs, deleting`);
            this.executor.cancel(scheduler.id);
            await database.destroy(database.scheduler, { where: { id: scheduler.id } });
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

    /** 列出所有 scheduler，附 nextRun。可按 profileId 过滤 */
    async list(profileId?: number): Promise<(SchedulerRow & { nextRun: number | null })[]> {
        const where: Record<string, any> = {};
        if (profileId != null) where.profileId = profileId;
        const rows = await database.findAll<SchedulerRow>(database.scheduler, { where, order: [['id', 'ASC']] });
        return rows.map(r => ({ ...(r as any), nextRun: r.enabled ? (this.nextDate(r.id) ?? r.nextRun) : null }));
    }

    findByPk(schedulerId: number): Promise<SchedulerRow | null> {
        return database.findByPk<SchedulerRow>(database.scheduler, schedulerId);
    }

    /** 工具/路由创建 scheduler 的统一入口：写表 + 注册 cron */
    async create(data: {
        channelSessionId: number;
        profileId: number;
        expr: string;
        message: string;
        aiProcess: boolean;
        maxRuns: number;
    }): Promise<SchedulerRow> {
        const row = await database.create<SchedulerRow>(database.scheduler, {
            ...data,
            enabled: true,
            lastRun: null,
            nextRun: null,
            runCount: 0,
            createdAt: Date.now(),
        });
        await this.schedule(row as SchedulerRow);
        return row;
    }

    async delete(schedulerId: number): Promise<void> {
        this.executor.cancel(schedulerId);
        await database.destroy(database.scheduler, { where: { id: schedulerId } });
    }

    /** 删除 profile 名下所有 scheduler（cancel cron + 硬删行）—— profile/session 删除时调用 */
    async cascadeDeleteByProfile(profileId: number): Promise<void> {
        const rows = await database.findAll<SchedulerRow>(database.scheduler, { where: { profileId } });
        for (const r of rows) this.executor.cancel(r.id);
        await database.destroy(database.scheduler, { where: { profileId } });
    }

    /** 按 id 列表硬删 scheduler（cancel cron + destroy）—— cleanupOrphans 在 profileId 失效时使用 */
    async cascadeDeleteByIds(ids: number[]): Promise<void> {
        if (ids.length === 0) return;
        for (const id of ids) this.executor.cancel(id);
        await database.destroy(database.scheduler, { where: { id: ids } });
    }

    async update(schedulerId: number, patch: Partial<Pick<SchedulerRow, "message" | "channelSessionId" | "aiProcess" | "enabled">>): Promise<SchedulerRow | null> {
        const fields: Partial<SchedulerRow> = {};
        if (patch.message != null)   fields.message   = patch.message;
        if (patch.aiProcess != null) fields.aiProcess = patch.aiProcess;
        if (patch.enabled != null)   fields.enabled   = patch.enabled;
        if (patch.channelSessionId != null) {
            // 改投递目标时 profileId 必须同步到新 session 的 profile，否则 list/delete 工具按 profileId 过滤会失配
            const session = await channelDataService.getSession(patch.channelSessionId, true);
            fields.channelSessionId = patch.channelSessionId;
            fields.profileId = session!.profileId;
        }
        if (Object.keys(fields).length === 0) return database.findByPk<SchedulerRow>(database.scheduler, schedulerId);
        await database.update(database.scheduler, fields, { where: { id: schedulerId } });
        if (fields.enabled != null) await this.reload(schedulerId);
        return database.findByPk<SchedulerRow>(database.scheduler, schedulerId);
    }

    async reload(schedulerId: number): Promise<void> {
        const scheduler = await database.findByPk<SchedulerRow>(database.scheduler, schedulerId);
        if (scheduler) await this.schedule(scheduler);
        else this.executor.cancel(schedulerId);
    }

    async triggerOnce(schedulerId: number): Promise<void> {
        await executeScheduler(schedulerId);
    }
}

export const schedulerService = new SchedulerService();
