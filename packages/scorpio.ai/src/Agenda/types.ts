// ===== Enums =====

/**
 * 主体状态。一条 agenda 的生命周期状态，与 trigger.enabled 是两件事
 * （取消整条 = Cancelled；只关闭某次触发 = trigger 自己的事）。
 */
export enum AgendaStatus {
    /** 待处理。新建后的默认状态，trigger 仍会按计划触发。 */
    Pending = 'pending',
    /** 已完成。complete() 调用后写入或调度耗尽自动置入；意味着整条不再触发。 */
    Done = 'done',
    /** 已取消。cancel() 调用后写入；trigger 全部 disable。 */
    Cancelled = 'cancelled',
    /** 已过期。一次性 trigger 错过或重试超时，且本条已无其它有效 trigger 时自动写入。 */
    Expired = 'expired',
}

/**
 * 优先级。仅作展示和排序提示，不影响调度行为。
 * LLM 说"重要的"/"紧急的" → High；说"顺手"/"低优" → Low；其余 → Normal（默认）。
 */
export enum AgendaPriority {
    Low = 'low',
    Normal = 'normal',
    High = 'high',
}

/**
 * 来源。用于追踪条目从哪来，影响去重/审计但不影响调度。
 */
export enum AgendaSource {
    /** 用户直接在 UI 操作。 */
    User = 'user',
    /** LLM 通过 agenda_create 工具创建（默认）。 */
    Tool = 'tool',
    /** 由 AgendaExtractor 从对话中自动抽取写入。 */
    Sync = 'sync',
    /** 由规则引擎/外部规则创建（预留）。 */
    Rule = 'rule',
}

/**
 * 执行者/归属。表达一条 agenda「算在谁头上」——item 主体级语义，与 per-trigger 的
 * action（触发时怎么投递）正交：一条「每天提醒张三交周报」可以 action=Notify 而 assignee=Other。
 * 由 LLM 在 create/update 时显式指定，不根据 trigger.action 自动推断。
 */
export enum AgendaAssignee {
    /** 用户自己完成。DB 兜底默认。 */
    User = 'user',
    /** 交给 AI 完成（LLM 说"你帮我总结/生成"时指定）。 */
    AI = 'ai',
    /** 第三方/外部完成，具体是谁见 assigneeName。 */
    Other = 'other',
}

/**
 * 触发器类型。表达 trigger.expr 字段的语义。
 */
export enum AgendaTriggerKind {
    /** 绝对时刻。expr = ISO 字符串，对应 args.at / args.after。 */
    Absolute = 'absolute',
    /** 固定间隔。expr = 毫秒数字符串，对应 args.every。 */
    Interval = 'interval',
    /** Cron 表达式。expr = 6 字段 cron 字符串，对应 args.cron。 */
    Cron = 'cron',
}

/**
 * 触发动作 = 通用的「session 投递模式」。
 * agenda trigger / heartbeat 都共用这一套，定义集中在 SessionDeliveryMode；
 * 这里以历史名 `AgendaTriggerAction` 对外别名导出，保持 agenda 模块对外的命名一致性。
 */
import { SessionDeliveryMode } from "../Trigger";
export { SessionDeliveryMode as AgendaTriggerAction };

// ===== DTOs =====

/**
 * 时间单位。AgendaRelativeTime 的合法 unit。
 */
export enum AgendaTimeUnit {
    Minute = 'minute',
    Hour = 'hour',
    Day = 'day',
    Week = 'week',
}

/**
 * 相对时间。仅用于"间隔"语义（every）。"未来时刻"统一用 ISO 字符串（at / startAt）。
 * LLM 说"每天" → { amount: 1, unit: 'day' }；"每 90 分钟" → { amount: 90, unit: 'minute' }。
 */
export interface AgendaRelativeTime {
    /** 数量。会被 floor 并取 max(1, ·)，所以传 0/负数会被规范成 1。 */
    amount: number;
    /** 单位。 */
    unit: AgendaTimeUnit;
}

/**
 * 所有 TriggerSpec 共享的投递字段。每条 trigger 自带 action/message，
 * 同一 item 上不同 trigger 可挂不同 action（如 9 点 invoke、18 点 notify）。
 */
interface TriggerSpecDelivery {
    /**
     * 触发动作。缺省 Notify。
     * LLM 说"每天帮我总结一下"/"每天 8 点帮我跑数据" → 显式传 Invoke（让 AI 处理）。
     * 想让 fire 进会话历史（便于用户随后回复"已交"时 AI 有上下文）→ NotifyAndRecord。
     */
    action?: SessionDeliveryMode;
    /**
     * 触发时投递的消息文本。必传：每条 trigger 都要显式给出投递文案，
     * 不再回退到 item.content。
     * LLM 说"每天 9 点用'记得交周报'提醒我" → message = "记得交周报"；
     * 没有特别指定时也应复述 content 作为提醒语（如 message = "喝水"）。
     */
    message: string;
    /**
     * 本条 trigger 投递的目标频道会话 id（per-trigger）。
     * 缺省 / 0 = 触发时自动解析归属本 agenda 模板的会话。
     * 由 admin 显式配置；优先级高于 batch 级的 args.channelSessionId。
     * 不在 LLM 工具 schema 暴露（TriggerSpecSchema 为手写 zod，不含此字段）。
     */
    channelSessionId?: number;
}

/**
 * Absolute 触发器：一次性，在 `at` 指定的 ISO 时刻触发。
 * LLM 说"明天 9 点提醒开会" → { kind: 'absolute', at: '2026-06-12T09:00:00' }。
 * "1 小时后" 的相对时刻请由 LLM 自行加到当前时间算成 ISO。
 */
export interface AgendaAbsoluteTriggerSpec extends TriggerSpecDelivery {
    kind: AgendaTriggerKind.Absolute;
    /** ISO 时刻字符串。 */
    at: string;
}

/**
 * Interval 触发器：固定间隔重复。
 * LLM 说"每天提醒我喝水" → { kind: 'interval', every: { amount: 1, unit: 'day' } }。
 * 配合 startAt 推迟首次、count 限定总次数。
 */
export interface AgendaIntervalTriggerSpec extends TriggerSpecDelivery {
    kind: AgendaTriggerKind.Interval;
    /** 间隔大小。 */
    every: AgendaRelativeTime;
    /**
     * 首次触发的 ISO 时刻；不传则在创建后一个 every 间隔触发。
     * LLM 说"从 100 天后开始每天提醒" → startAt = 当前时间 + 100 天的 ISO。
     */
    startAt?: string;
    /** 总触发次数上限；省略=无限。LLM 说"连续提醒 7 天" → count = 7。 */
    count?: number;
}

/**
 * Cron 触发器：cron 表达式驱动的重复。
 * LLM 说"工作日 9 点" → { kind: 'cron', expr: '0 0 9 * * 1-5' }。
 */
export interface AgendaCronTriggerSpec extends TriggerSpecDelivery {
    kind: AgendaTriggerKind.Cron;
    /** 6 字段 cron 表达式（秒 分 时 日 月 周）。 */
    expr: string;
    /** 首次触发的 ISO 时刻；不传则取当前时间之后的第一个 cron 命中。 */
    startAt?: string;
    /** 总触发次数上限；省略=无限。 */
    count?: number;
}

/**
 * 触发器规格。create/update 时传给 service，service 根据 kind 走对应分支建 trigger。
 */
export type AgendaTriggerSpec =
    | AgendaAbsoluteTriggerSpec
    | AgendaIntervalTriggerSpec
    | AgendaCronTriggerSpec;

/**
 * 创建参数。LLM 通过 agenda_create 工具调用这个。
 * 时间相关全部走 triggers 字段（数组）；不传或 [] = 纯 Todo（无调度）。
 * action / message 写在每条 trigger spec 内（per-trigger，非 batch 级）。
 */
export interface AgendaCreateArgs {
    /** 主内容。LLM 说"提醒我喝水" → "喝水"。trim 后非空，否则抛错。 */
    content: string;
    /** 优先级。默认 Normal。 */
    priority?: AgendaPriority;
    /** 执行者/归属。缺省 User。LLM 按语义显式指定（用户自己=user、让 AI 做=ai、交给他人=other）。 */
    assignee?: AgendaAssignee;
    /** 第三方名字。仅 assignee=Other 时写入，其余忽略。 */
    assigneeName?: string;
    /**
     * 调度规格列表。每条 spec 自带 action / message。
     * - 单个时间点：传 1 元素数组，例 [{ kind: 'absolute', at: '...', action: 'invoke' }]
     * - 多个 active triggers：可分别配 action（9 点 invoke、18 点 notify）
     * - 省略或 [] = 纯 Todo（无调度）
     */
    triggers?: AgendaTriggerSpec[];
    /**
     * 截止时刻（ISO 字符串）。仅作为「目标完成时刻」的语义字段：
     * - 用作 findNearDuplicate 去重 key（content + dueAt 一致视为重复）
     * - UI/LLM 展示「已过期」标记
     * - 列表排序兜底
     * 不会派生任何 trigger——若要在截止时被提醒，调用方需显式传 triggers。
     * 主要给纯 Todo 用——LLM 说"周五前写完周报" → dueAt = "2026-06-13T23:59:59"。
     * 显式传入优先；不传则由 triggers 推导：Reminder=trigger.at，Routine+count=最后一次触发时刻。
     */
    dueAt?: string;
    /** 来源标记。LLM 调用时一般不传，由 service 根据上下文写入（Tool / Sync）。 */
    source?: AgendaSource;
    /**
     * 新建 trigger 写到 trigger.channelSessionId 的频道会话 id。
     * 调用方（tool / extractor / route）按上下文注入；缺省 = 0。
     * 不在 LLM 工具 schema 暴露。
     */
    channelSessionId?: number;
}

/**
 * 更新 agenda item 主体字段。仅改主体，不碰调度——trigger 的增改删一律走
 * addTrigger / patchTrigger / removeTrigger / replaceTriggers（LLM 侧统一走 agenda_edit 的 triggers 数组）。
 */
export interface AgendaUpdatePatch {
    /** 改内容。LLM 说"把 #3 改成 '交月报'" → content = "交月报"。 */
    content?: string;
    priority?: AgendaPriority;
    /** 改执行者/归属。 */
    assignee?: AgendaAssignee;
    /** 改第三方名字（null 清空）。改成非 Other 归属时由 service 自动清空。 */
    assigneeName?: string | null;
    /**
     * 显式改 dueAt（ISO 字符串或 null 清空）。
     * 纯主体字段，不联动现有 trigger 的节奏。
     */
    dueAt?: string | null;
}

/**
 * trigger_add / trigger_update 的载荷：直接就是 TriggerSpec（含 action/message）+ channelSessionId。
 * 没有外层 `trigger:` 包裹，单 trigger 操作的 spec 平铺。
 *
 * 语义：
 * - trigger_add：append 一条新 trigger
 * - trigger_update：用 spec 整体覆盖目标 trigger（fireCount / lastFiredAt 重置）
 *   只想改 action / message 而保留触发进度 → 用 AgendaTriggerPatch 走 patchTrigger。
 */
export type AgendaTriggerCreateArgs = AgendaTriggerSpec & { channelSessionId?: number };
export type AgendaTriggerUpdatePatch = AgendaTriggerSpec & { channelSessionId?: number };

/**
 * 触发器**部分**更新（patchTrigger / agenda_edit 用），与 AgendaTriggerUpdatePatch 的整体覆盖相对：
 * 只传要改的字段，未传的沿用当前值，且 fireCount / lastFiredAt **一律保留**。
 *
 * 这是"只想把 notify 改成 invoke"的正确入口——不必重打一遍 cron，也不丢触发进度。
 * nextFireAt 只在 schedule 字段（kind / at / every / expr）真的变了、或显式给了 startAt 时才重算。
 *
 * 改 kind 必须同时给出新 kind 对应的 schedule 字段（absolute→at / interval→every / cron→expr），
 * 否则 expr 的语义会与 kind 错位，service 会抛错拒绝。
 */
export interface AgendaTriggerPatch {
    /** 换触发器类型。必须同时给新 kind 的 schedule 字段。 */
    kind?: AgendaTriggerKind;
    /** kind=absolute 的新时刻（ISO）。 */
    at?: string;
    /** kind=interval 的新间隔。 */
    every?: AgendaRelativeTime;
    /** kind=cron 的新 6 字段表达式。 */
    expr?: string;
    /** 显式重设下次触发时刻（ISO）。不改 schedule 也可单独用它推迟一次。 */
    startAt?: string;
    /** 改总次数上限；0 / 省略语义同 create（0=无限）。 */
    count?: number;
    action?: SessionDeliveryMode;
    message?: string;
    /** 投递通道；不在 LLM schema 暴露。 */
    channelSessionId?: number;
}

/**
 * agenda_edit 里的单个触发器操作。三种：
 * - add：追加一条（spec 与 create.triggers[i] 同形）
 * - patch：部分改一条（见 AgendaTriggerPatch）
 * - remove：停用一条
 *
 * 没有 replace_all——同一次 edit 里 remove 旧的 + add 新的即可，语义等价且无需额外 op。
 */
export type AgendaTriggerEdit =
    | { op: 'add'; spec: AgendaTriggerSpec }
    | { op: 'patch'; id: number; patch: AgendaTriggerPatch }
    | { op: 'remove'; id: number };

/**
 * agenda_edit 的完整载荷：主体字段 + 触发器操作列表，**一次调用原子生效**。
 *
 * 这样设计是为了让"改节奏必须同步改 content / 其他 trigger 文案"这类跨字段一致性
 * 由结构保证，而不是靠 prompt 要求 LLM 在同一轮里记得多调几次工具
 * （分多次调用时，中间失败会留下"显示的名字与实际调度矛盾"的脏状态）。
 */
export interface AgendaEditArgs {
    /** 主体字段改动；语义同 AgendaUpdatePatch。 */
    set?: AgendaUpdatePatch;
    /** 触发器操作，按数组顺序依次执行。 */
    triggers?: AgendaTriggerEdit[];
    /** 新建 trigger 的投递通道；不在 LLM schema 暴露。 */
    channelSessionId?: number;
}

/**
 * 终结一条 agenda 的方式。两者落库效果相同（整条置终态 + 停掉所有 trigger），
 * 差别只在 status 记录的意图：做完了 vs 不要了。
 */
export enum AgendaCloseOutcome {
    /** 做完了 → status=done，写 doneAt。 */
    Done = 'done',
    /** 不要了 / 别再提醒 → status=cancelled，不写 doneAt。 */
    Dropped = 'dropped',
}

export interface AgendaTriggerReplaceAllArgs {
    /** 完整新 trigger 列表（每条自带 action/message）。[] = 清空。 */
    triggers: AgendaTriggerSpec[];
    channelSessionId?: number;
}

/**
 * 列表过滤。LLM 通过 agenda_list 工具调用这个。
 */
export interface AgendaListFilter {
    /** 状态过滤。'all' = 不限。缺省 = Pending。 */
    status?: AgendaStatus | 'all';
    /** 仅返回某优先级。 */
    priority?: AgendaPriority;
    /** 仅返回某执行者/归属（如 user = 我的待办、ai = 交给你的）。 */
    assignee?: AgendaAssignee;
    /** 上限条数。缺省 50，下限 1。 */
    limit?: number;
}

/**
 * 创建结果。命中近重复时 created=false / existed=true，不会重复建条。
 */
export interface AgendaCreateResult {
    /** 命中重复时返回已存在的记录，否则是新建条目的记录。 */
    item: AgendaRecord;
    /** 是否本次新建。 */
    created: boolean;
    /** 是否命中了 findNearDuplicate（同内容 + 同 dueAt ±2 分钟内的 Pending 项）。 */
    existed: boolean;
}

// ===== Entities =====

/**
 * agenda 主体表行。trigger 在各自的子表里。
 * 时间戳统一是毫秒（Date.now()），不是秒。
 */
export interface AgendaItem {
    /** 自增主键。LLM 看到的 #1 / #2 / ... 就是这个。 */
    id: number;
    /** 主内容。 */
    content: string;
    status: AgendaStatus;
    priority: AgendaPriority;
    /**
     * 执行者/归属。默认 User。用于「我/你还有多少待办」的区分统计与过滤。
     */
    assignee: AgendaAssignee;
    /**
     * 第三方执行者名字。仅 assignee === Other 时有意义；其余情形恒为 null。
     */
    assigneeName: string | null;
    /**
     * 截止时间戳（毫秒）。写入规则（优先级从高到低）：
     * - args.dueAt 显式传 → 用它
     * - trigger.kind === Absolute → trigger.at
     * - trigger.kind === Interval && count > 0 → startTime + (count-1) * everyMs（最后一次触发时刻）
     * - 其他（Cron / 无 count 的周期 / 无 trigger 且未传 dueAt）→ null
     * 用途：列表排序回退、findNearDuplicate 去重 key、UI "已过期"判断、LLM format 的 due= 字段。
     */
    dueAt: number | null;
    source: AgendaSource;
    /** 创建时间戳（毫秒）。 */
    createdAt: number;
    /** 最近一次更新时间戳。 */
    updatedAt: number;
    /** 完成时间戳；尚未 Done 时为 null。 */
    doneAt: number | null;
}

/**
 * 触发器表行。一个 agenda 主体可以有 0..N 个 trigger，
 * 但当前 service 在调度变更时会 disable 旧的，实际激活的通常是 1 个。
 */
export interface AgendaTrigger {
    id: number;
    /** 反向指向 AgendaItem.id。 */
    itemId: number;
    kind: AgendaTriggerKind;
    /**
     * 触发表达式，语义随 kind 变化：
     * - Absolute：ISO 时间字符串（如 "2026-09-01T09:00:00.000Z"）
     * - Interval：毫秒数字符串（如 "86400000" = 1 天）
     * - Cron：6 字段 cron 字符串
     */
    expr: string;
    action: SessionDeliveryMode;
    /** 投递文本。每条 trigger 必带，不再回退到 item.content。 */
    message: string;
    /** 投递通道（频道会话 id）。新建/替换 trigger 时由调用方注入；0 = 触发时自动解析归属会话。 */
    channelSessionId: number;
    /** 是否激活。disable 后 engine 不再调度这条；占位保留历史。 */
    enabled: boolean;
    /** 已成功触发次数。 */
    fireCount: number;
    /**
     * 触发上限。
     * - 0 = 无限（every/cron 默认）
     * - 1 = 一次性（absolute 默认）
     * - N = 触发 N 次后 disable（对应 args.count）
     */
    maxFires: number;
    /** 上次触发时间戳；尚未触发为 null。 */
    lastFiredAt: number | null;
    /**
     * 下次触发时间戳。null 表示已停止（disable 或 maxFires 已耗尽）。
     * 引擎按这个值调度 setTimeout。
     */
    nextFireAt: number | null;
    createdAt: number;
}

/**
 * trigger fire 事件日志行。每次 trigger 触发（含手动）落一行，纯记录、不参与任何调度/完成逻辑。
 * 不进 AgendaRecord，也不暴露给 LLM；仅供审计 / 将来统计。
 */
export interface AgendaTriggerFire {
    id: number;
    /** 触发的 trigger。 */
    triggerId: number;
    /** 所属 agenda item。 */
    itemId: number;
    /** 计划触发时刻（毫秒）。 */
    scheduledAt: number;
    /** 实际触发时刻（毫秒）。 */
    firedAt: number;
    /** 是否投递成功。 */
    delivered: boolean;
    /** 投递模式（notify / notify_and_record / invoke）。 */
    action: SessionDeliveryMode;
    /**
     * 本次触发的描述，两行「内容 / 结果」：
     *   内容：<触发内容（截断）>
     *   结果：已发送 / 发送失败: <原因> / 已触发 AI 执行（invoke 异步，触发当下拿不到最终结果）
     */
    message: string;
}

/**
 * agenda 两件套：item 主行 + 关联 trigger 列表。
 * AgendaStore 直接产出此结构；service / 上层 list/format/UI 也直接消费它。
 */
export interface AgendaRecord {
    item: AgendaItem;
    triggers: AgendaTrigger[];
}
