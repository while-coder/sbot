import { CronJob } from "cron";
import { LarkMessageArgs, LarkReceiveIdType } from "winning.ai";
import { database, SchedulerRow, UserRow } from "../Database";
import { userService } from "../UserService/UserService";
import { LoggerService } from "../LoggerService";
import { globalLarkService } from "../Lark/LarkServiceInit";

const logger = LoggerService.getLogger("SchedulerService.ts");

/**
 * 执行调度任务：
 * - userId 有效且用户存在 → onReceiveLarkMessage（回复到 Lark）
 * - userId 未设置或用户不存在 → onReceiveWebMessage（仅走 Agent 管线，不回复 Lark）
 */
async function executeScheduler(timerId: number): Promise<void> {
    const timer = await database.findByPk<SchedulerRow>(database.scheduler, timerId);
    if (!timer?.enabled) return;

    const agentName = timer.agentName || undefined;

    // 尝试通过 userId 找到对应的 Lark 用户
    const userRow = timer.userId
        ? await database.findByPk<UserRow>(database.user, timer.userId)
        : null;

    if (userRow && globalLarkService) {
        // 有 Lark 用户 → 走 Lark 通道回复
        let userInfo: any = {};
        try { userInfo = JSON.parse(userRow.userinfo || "{}"); } catch { /**/ }

        const args: LarkMessageArgs & { agentName?: string } = {
            larkService: globalLarkService,
            chat_type: "",
            chat_id: "",
            message_id: "",
            root_id: "",
            chatInfo: { receiveId: userRow.userid, receiveIdType: LarkReceiveIdType.UserId },
            ...(agentName ? { agentName } : {}),
        };
        try {
            await userService.onReceiveLarkMessage(args, userInfo, timer.message);
            logger.info(`调度任务 [${timer.id}:${timer.name}] 已触发（Lark），用户 ${userRow.userid}`);
        } catch (e: any) {
            logger.error(`调度任务 [${timer.id}:${timer.name}] 执行失败: ${e?.message ?? e}`);
        }
    } else {
        // 无 Lark 用户 → 走 Web 通道（无实际推送，仅执行 Agent）
        if (timer.userId) {
            logger.warn(`调度任务 [${timer.id}:${timer.name}] userId=${timer.userId} 在 user 表中不存在，降级为 Web 模式`);
        }
        try {
            await userService.onReceiveWebMessage(timer.message, () => { /* 调度触发，无需推送 */ });
            logger.info(`调度任务 [${timer.id}:${timer.name}] 已触发（Web）`);
        } catch (e: any) {
            logger.error(`调度任务 [${timer.id}:${timer.name}] 执行失败: ${e?.message ?? e}`);
        }
    }

    await database.update(database.scheduler, { lastRun: Date.now() }, { where: { id: timer.id } });
}

class SchedulerService {
    private jobs = new Map<number, CronJob>();

    async start(): Promise<void> {
        const timers = await database.findAll<SchedulerRow>(database.scheduler, { where: { enabled: true } });
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
        if (timer?.enabled) this.schedule(timer);
    }

    stop(): void {
        for (const id of this.jobs.keys()) this.cancel(id);
        logger.info("调度服务已停止");
    }
}

export const schedulerService = new SchedulerService();
