import { CronJob } from "cron";
import { LarkService, LarkMessageArgs } from "channel.lark";
import { SlackService, SlackMessageArgs } from "channel.slack";
import { WecomService, WecomMessageArgs } from "channel.wecom";
import { database, SchedulerRow, ChannelSessionRow, SchedulerType } from "../Core/Database";
import { userService } from "../UserService/UserService";
import { LoggerService } from "../Core/LoggerService";
import { config, ChannelType } from "../Core/Config";
import { channelManager } from "../Channel/ChannelManager";

const logger = LoggerService.getLogger("SchedulerService.ts");

async function executeScheduler(schedulerId: number): Promise<void> {
    const scheduler = await database.findByPk<SchedulerRow>(database.scheduler, schedulerId);
    if (!scheduler) return;

    const tag = `[${scheduler.id}]`;
    const isChannel = scheduler.type === SchedulerType.Channel;

    try {
        if (isChannel) {
            const sessionRow = scheduler.targetId
                ? await database.findByPk<ChannelSessionRow>(database.channelSession, parseInt(scheduler.targetId))
                : null;
            const service = sessionRow?.channelId
                ? channelManager.getService(sessionRow.channelId)
                : undefined;

            if (!sessionRow || !service) {
                logger.error(`Scheduler task ${tag} channel mode: targetId=${scheduler.targetId} not found or has no service`);
                return;
            }

            const { channelId, sessionId, id: dbSessionId } = sessionRow;
            const channelType = config.getChannel(channelId)?.type;

            if (channelType === ChannelType.Lark) {
                const args: LarkMessageArgs = {
                    larkService: service as LarkService,
                    event_id: "", chat_type: "", chat_id: sessionId, message_id: "", root_id: "",
                };
                await userService.onReceiveLarkMessage(scheduler.message, args, {}, channelId, dbSessionId);
            } else if (channelType === ChannelType.Slack) {
                const args: SlackMessageArgs = {
                    slackService: service as SlackService,
                    eventId: "", channel: sessionId, ts: "",
                };
                await userService.onReceiveSlackMessage(scheduler.message, args, {}, channelId, dbSessionId);
            } else if (channelType === ChannelType.Wecom) {
                const args: WecomMessageArgs = {
                    wecomService: service as WecomService,
                    chatid: sessionId, chattype: 'single', msgid: '', frame: null as any,
                };
                await userService.onReceiveWecomMessage(scheduler.message, args, {}, channelId, dbSessionId);
            } else {
                logger.warn(`Scheduler task ${tag} unknown channel type: ${channelType}`);
                return;
            }
            logger.info(`Scheduler task ${tag} fired (${channelType}), session ${sessionId}`);
        } else {
            // Session / directory mode: deliver via HTTP pipeline
            const sessionId = scheduler.type === SchedulerType.Session    ? scheduler.targetId ?? undefined : undefined;
            const workPath  = scheduler.type === SchedulerType.Directory  ? scheduler.targetId ?? undefined : undefined;
            await userService.onReceiveWebMessage(
                scheduler.message,
                sessionId,
                workPath,
            );
            logger.info(`Scheduler task ${tag} fired (http), sessionId=${sessionId ?? '-'} workPath=${workPath ?? '-'}`);
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
    private jobs = new Map<number, CronJob>();

    async start(): Promise<void> {
        const schedulers = await database.findAll<SchedulerRow>(database.scheduler);
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

        if (scheduler.maxRuns > 0 && (scheduler.runCount ?? 0) >= scheduler.maxRuns) {
            logger.info(`Scheduler task [${scheduler.id}] reached max runs, cleaning up`);
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

    /** 取消调度并从数据库删除 */
    async delete(schedulerId: number): Promise<void> {
        this.cancel(schedulerId);
        await database.destroy(database.scheduler, { where: { id: schedulerId } });
    }

    /** 重新从 DB 加载并重新调度（外部增删改后调用） */
    async reload(schedulerId: number): Promise<void> {
        const scheduler = await database.findByPk<SchedulerRow>(database.scheduler, schedulerId);
        if (scheduler) await this.schedule(scheduler);
        else this.cancel(schedulerId);
    }
}

export const schedulerService = new SchedulerService();
