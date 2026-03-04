import { CronJob } from "cron";
import { LarkMessageArgs, LarkReceiveIdType } from "winning.ai";
import { database, TimerRow, TimerType, UserRow } from "./Database";
import { userService } from "./UserService/UserService";
import { LoggerService } from "./LoggerService";
import { globalLarkService } from "./Lark/LarkServiceInit";

const logger = LoggerService.getLogger("TimerService.ts");

/**
 * 将计时器配置转换为 cron 表达式
 *
 * daily:   { time: "09:00" }               → "0 9 * * *"
 * weekly:  { dayOfWeek: 1, time: "09:00" } → "0 9 * * 1"  (0=周日, 1=周一 ...)
 * monthly: { dayOfMonth: 1, time: "09:00" }→ "0 9 1 * *"
 * interval:{ minutes: 30 }                 → "* /30 * * * *"  (1-59分钟)
 * hourly:  { minute?: 0 }                  → "0 * * * *"  (每小时指定分钟)
 * cron:    { expr: "0 9 * * *" }           → 直接使用自定义表达式
 */
function toCronExpression(type: TimerType, cfg: any): string {
    if (type === TimerType.Interval) {
        const minutes = Math.min(59, Math.max(1, Math.floor(cfg.minutes ?? 1)));
        return `*/${minutes} * * * *`;
    }

    if (type === TimerType.Hourly) {
        const minute = Math.min(59, Math.max(0, Math.floor(cfg.minute ?? 0)));
        return `${minute} * * * *`;
    }

    if (type === TimerType.Cron) {
        if (!cfg.expr) throw new Error("cron 类型缺少 expr 字段");
        return cfg.expr as string;
    }

    const [hStr, mStr] = (cfg.time ?? "09:00").split(":");
    const h = parseInt(hStr, 10) || 0;
    const m = parseInt(mStr, 10) || 0;

    if (type === TimerType.Daily) {
        return `${m} ${h} * * *`;
    }

    if (type === TimerType.Weekly) {
        const dow = cfg.dayOfWeek ?? 1; // 0=周日, 1=周一 ...
        return `${m} ${h} * * ${dow}`;
    }

    if (type === TimerType.Monthly) {
        const dom = cfg.dayOfMonth ?? 1; // 1-31
        return `${m} ${h} ${dom} * *`;
    }

    throw new Error(`未知计时器类型: ${type}`);
}

/**
 * 执行计时器动作：通过 onReceiveLarkMessage 走完整 Agent 管线
 */
async function executeTimer(timerId: number): Promise<void> {
    const timer = await database.findByPk<TimerRow>(database.timer, timerId);
    if (!timer?.enabled) return;
    if (!globalLarkService) return

    if (!timer.userId) {
        logger.warn(`计时器 [${timer.id}:${timer.name}] 未配置 userId，跳过`);
        return;
    }

    const userRow = await database.findByPk<UserRow>(database.user, timer.userId);
    if (!userRow) {
        logger.warn(`计时器 [${timer.id}:${timer.name}] userId=${timer.userId} 在 user 表中不存在，跳过`);
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
        logger.info(`计时器 [${timer.id}:${timer.name}] 已触发，用户 ${userRow.userid}`);
    } catch (e: any) {
        logger.error(`计时器 [${timer.id}:${timer.name}] 执行失败: ${e?.message ?? e}`);
    }

    await database.update(database.timer, { lastRun: Date.now() }, { where: { id: timer.id } });
}

class TimerService {
    private jobs = new Map<number, CronJob>();

    async start(): Promise<void> {
        const timers = await database.findAll<TimerRow>(database.timer, { where: { enabled: true } });
        for (const timer of timers) {
            this.schedule(timer);
        }
        logger.info(`计时器服务启动，已加载 ${timers.length} 个计时器`);
    }

    /** 调度单个计时器 */
    schedule(timer: TimerRow): void {
        this.cancel(timer.id);

        let cfg: any = {};
        try { cfg = JSON.parse(timer.config || "{}"); } catch { /**/ }

        let cronExpr: string;
        try {
            cronExpr = toCronExpression(timer.type, cfg);
        } catch (e: any) {
            logger.error(`计时器 [${timer.id}:${timer.name}] 表达式生成失败: ${e?.message}`);
            return;
        }

        const job = CronJob.from({
            cronTime: cronExpr,
            onTick: () => executeTimer(timer.id),
            start: true,
            waitForCompletion: true,
        });

        this.jobs.set(timer.id, job);
        logger.info(`计时器 [${timer.id}:${timer.name}] 已调度 (${cronExpr})，下次执行: ${job.nextDate().toISO()}`);
    }

    /** 取消某个计时器的调度 */
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
        const timer = await database.findByPk<TimerRow>(database.timer, timerId);
        if (timer?.enabled) this.schedule(timer);
    }

    stop(): void {
        for (const id of this.jobs.keys()) this.cancel(id);
        logger.info("计时器服务已停止");
    }
}

export const timerService = new TimerService();
