import type { ChatMessage } from "../../Saver";
import type {
    AgendaItem,
    AgendaRecord,
    AgendaTrigger,
    AgendaTriggerFire,
} from "../types";

// ── 待处理 job 队列 ──

export enum AgendaPendingJobType {
    Extract = 'extract',
}

export type AgendaPendingJobStatus = 'pending' | 'failed';

export interface PendingAgendaJobRow {
    id: number;
    type: AgendaPendingJobType;
    /** 该 job 来自哪个 channel session；drain 时回填到 createTrigger 的 channelSessionId。 */
    channelSessionId: number;
    /** Extract 任务的对话快照。 */
    messages?: ChatMessage[];
    status: AgendaPendingJobStatus;
    attemptCount: number;
    errorMessage: string | null;
    createdAt: number;
    updatedAt: number;
}

/**
 * 单 agenda 模板维度的存储。每个实例只读写一个模板的 db 文件，
 * 不允许跨模板访问。所有方法都隐式作用于该模板的数据。
 */
export interface IAgendaStore {
    listItems(): Promise<AgendaRecord[]>;
    findItem(itemId: number): Promise<AgendaRecord | null>;
    findTrigger(triggerId: number): Promise<{ data: AgendaRecord; trigger: AgendaTrigger } | null>;
    listEnabledTriggers(): Promise<AgendaTrigger[]>;
    createItem(item: Omit<AgendaItem, "id">): Promise<AgendaRecord>;
    updateItem(itemId: number, fields: Partial<AgendaItem>): Promise<AgendaRecord | null>;
    updateTrigger(triggerId: number, fields: Partial<AgendaTrigger>): Promise<AgendaRecord | null>;
    updateActiveTriggersByItem(itemId: number, fields: Partial<AgendaTrigger>, exceptTriggerIds: number[]): Promise<number[]>;
    appendTrigger(itemId: number, trigger: Omit<AgendaTrigger, "id">): Promise<AgendaTrigger | null>;
    /**
     * 记录一次 trigger fire 事件（含手动触发）。纯写入日志，不参与任何调度/完成逻辑。
     * 返回写入的行（含自增 id）；item 不存在时返回 null。
     */
    insertTriggerFire(fire: Omit<AgendaTriggerFire, "id">): Promise<AgendaTriggerFire | null>;
    /**
     * 读 trigger fire 审计日志（insertTriggerFire 的逆向只读视图）。
     * 按 triggerId / itemId 过滤（都传则取交集），按 firedAt DESC 返回最近的若干条。
     * limit 缺省 DEFAULT_TRIGGER_FIRES_LIMIT，上限 MAX_TRIGGER_FIRES_PER_ITEM。仅 admin 查看用。
     */
    listTriggerFires(filter?: { triggerId?: number; itemId?: number; limit?: number }): Promise<AgendaTriggerFire[]>;
    deleteItem(itemId: number): Promise<AgendaRecord | null>;
    /** 物理删除单条 trigger（与软停用 updateTrigger 区分），返回所属 item 的最新记录；不存在返回 null。 */
    deleteTrigger(triggerId: number): Promise<AgendaRecord | null>;
    deleteAll(): Promise<number[]>;

    /**
     * 把多次 store 调用绑成一个原子块（共享同一把内部锁）。
     * 用于 service 层 read-then-write 模式（如 findNearDuplicate + createItem），
     * 避免 tool 路径与 sync drain 之间的双写 race。
     * fn 内部直接调 store 方法即可；锁是可重入的。
     */
    runExclusive<T>(fn: () => Promise<T> | T): Promise<T>;

    // ── 待处理抽取 job 队列 ──
    // 全部同步：底层 better-sqlite3 是同步 API；AgendaService 依赖
    // "push 的 SQL 在 kick 前已落库" 这一点来避免漏单。

    /** 入队一轮对话的消息快照，返回插入行 id。 */
    pushPendingMessages(channelSessionId: number, messages: ChatMessage[], now: number): number;

    /** 取最早一条 status='pending' 的 job；没有返回 null。串行消费由 AgendaService 内部 isRunning 标志保证。 */
    popPendingJob(): PendingAgendaJobRow | null;

    /** 删除一行（成功消费后调用）。 */
    deletePendingJob(id: number): void;

    /** 标记失败（保留数据），attemptCount += 1。 */
    markPendingJobFailed(id: number, errorMessage: string, now: number): void;

    /** 管理/排障用：列最近的 pending+failed job（按 id DESC）。 */
    listPendingJobs(limit: number): PendingAgendaJobRow[];

    dispose(): void;
}

export const IAgendaStore = Symbol("IAgendaStore");
