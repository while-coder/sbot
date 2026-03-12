import { CronJob } from "cron";
import { LarkMessageArgs, LarkReceiveIdType } from "channel.lark";
import { database, SchedulerRow, UserRow, ContextType } from "../Core/Database";
import { userService } from "../UserService/UserService";
import { LoggerService } from "../Core/LoggerService";
import { LarkService } from "channel.lark";
import { channelManager } from "../Channel/ChannelManager";

const logger = LoggerService.getLogger("SchedulerService.ts");

async function executeScheduler(timerId: number): Promise<void> {
    const timer = await database.findByPk<SchedulerRow>(database.scheduler, timerId);
    if (!timer) return;

    const tag = `[${timer.id}:${timer.name}]`;
    const isChannel = timer.type === ContextType.Channel
        || (timer.type == null && timer.userId != null);

    try {
        if (isChannel) {
            // Channel mode: deliver via Lark
            const userRow = timer.userId
                ? await database.findByPk<UserRow>(database.user, timer.userId)
                : null;
            const larkService = userRow?.channel
                ? channelManager.getService(userRow.channel) as LarkService | undefined
                : undefined;

            if (!userRow || !larkService) {
                logger.error(`Scheduler task ${tag} channel mode: userId=${timer.userId} not found or has no Lark service`);
                return;
            }

            let userInfo: any = {};
            try { userInfo = JSON.parse(userRow.userinfo || "{}"); } catch { /**/ }

            const args: LarkMessageArgs = {
                larkService,
                chat_type: "",
                chat_id: "",
                message_id: "",
                root_id: "",
                chatInfo: { receiveId: userRow.userid, receiveIdType: (userRow.userIdType ?? LarkReceiveIdType.UnionId) as LarkReceiveIdType },
            };
            await userService.onReceiveLarkMessage(args, userInfo, timer.message, userRow.channel);
            logger.info(`Scheduler task ${tag} fired (channel), user ${userRow.userid}`);
        } else {
            // Session / directory mode: deliver via HTTP pipeline
            await userService.onReceiveHttpMessage(
                timer.message,
                null,
                timer.sessionId ?? undefined,
                timer.workPath ?? undefined,
            );
            logger.info(`Scheduler task ${tag} fired (http), sessionId=${timer.sessionId ?? '-'} workPath=${timer.workPath ?? '-'}`);
        }
    } catch (e: any) {
        logger.error(`Scheduler task ${tag} failed: ${e?.message ?? e}`);
    }

    await database.update(database.scheduler, { lastRun: Date.now() }, { where: { id: timer.id } });
}

class SchedulerService {
    private jobs = new Map<number, CronJob>();

    async start(): Promise<void> {
        const timers = await database.findAll<SchedulerRow>(database.scheduler);
        for (const timer of timers) {
            this.schedule(timer);
        }
        logger.info(`调度服务启动，已加载 ${timers.length} 个调度任务`);
    }

    /** 调度单个任务 */
    schedule(timer: SchedulerRow): void {
        this.cancel(timer.id);

        if (!timer.expr?.trim()) {
            logger.error(`调度任务 [${timer.id}:${timer.name}] cron 表达式为空，跳过`);
            return;
        }

        try {
            const job = CronJob.from({
                cronTime: timer.expr,
                onTick: () => executeScheduler(timer.id),
                start: true,
                waitForCompletion: true,
            });
            this.jobs.set(timer.id, job);
            logger.info(`调度任务 [${timer.id}:${timer.name}] 已调度 (${timer.expr})，下次执行: ${job.nextDate().toISO()}`);
        } catch (e: any) {
            logger.error(`调度任务 [${timer.id}:${timer.name}] 调度失败: ${e?.message}`);
        }
    }

    /** Returns the next scheduled timestamp (ms) for a timer, or null if not scheduled */
    nextDate(timerId: number): number | null {
        const job = this.jobs.get(timerId);
        if (!job) return null;
        try { return job.nextDate().toMillis(); } catch { return null; }
    }

    /** 取消某个任务的调度 */
    cancel(timerId: number): void {
        const job = this.jobs.get(timerId);
        if (job) {
            job.stop();
            this.jobs.delete(timerId);
        }
    }

    /** 重新从 DB 加载并重新调度（外部增删改后调用） */
    async reload(timerId: number): Promise<void> {
        this.cancel(timerId);
        const timer = await database.findByPk<SchedulerRow>(database.scheduler, timerId);
        if (timer) this.schedule(timer);
    }

    stop(): void {
        for (const id of this.jobs.keys()) this.cancel(id);
        logger.info("调度服务已停止");
    }
}

export const schedulerService = new SchedulerService();
