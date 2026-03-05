import { CronJob } from "cron";
import { LarkMessageArgs, LarkReceiveIdType } from "winning.ai";
import { database, SchedulerRow, UserRow } from "../Database";
import { userService } from "../UserService/UserService";
import { LoggerService } from "../LoggerService";
import { globalLarkService } from "../Lark/LarkServiceInit";

const logger = LoggerService.getLogger("SchedulerService.ts");

/**
 * 执行调度任务：通过 onReceiveLarkMessage 走完整 Agent 管线
 */
async function executeScheduler(timerId: number): Promise<void> {
    const timer = await database.findByPk<SchedulerRow>(database.scheduler, timerId);
    if (!timer?.enabled) return;
    if (!globalLarkService) return

    if (!timer.userId) {
        logger.warn(`调度任务 [${timer.id}:${timer.name}] 未配置 userId，跳过`);
        return;
    }

    const userRow = await database.findByPk<UserRow>(database.user, timer.userId);
    if (!userRow) {
        logger.warn(`调度任务 [${timer.id}:${timer.name}] userId=${timer.userId} 在 user 表中不存在，跳过`);
        return;
    }

    let userInfo: any = {};
    try { userInfo = JSON.parse(userRow.userinfo || "{}"); } catch { /**/ }

    const args: LarkMessageArgs & { agentName?: string } = {
        larkService: globalLarkService,
        chat_type: "",
        chat_id: "",
        message_id: "",
        root_id: "",
        chatInfo: { receiveId: userRow.userid, receiveIdType: LarkReceiveIdType.UserId },
        ...(timer.agentName ? { agentName: timer.agentName } : {}),
    };

    try {
        await userService.onReceiveLarkMessage(args, userInfo, timer.message);
        logger.info(`调度任务 [${timer.id}:${timer.name}] 已触发，用户 ${userRow.userid}`);
    } catch (e: any) {
        logger.error(`调度任务 [${timer.id}:${timer.name}] 执行失败: ${e?.message ?? e}`);
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
