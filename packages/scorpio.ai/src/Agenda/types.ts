// ===== Enums =====

/**
 * 主体状态。一条 agenda 的生命周期状态，与 trigger.enabled 是两件事
 * （取消整条 = Cancelled；只关闭某次触发 = trigger 自己的事）。
 */
export enum AgendaStatus {
    /** 待处理。新建后的默认状态，trigger 仍会按计划触发。 */
    Pending = 'pending',
    /** 已完成。complete() 调用后写入；非 Occurrence 模式下意味着不再触发。 */
    Done = 'done',
    /** 已取消。cancel() 调用后写入；trigger 全部 disable。 */
    Cancelled = 'cancelled',
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
 * 类别。决定默认 completionMode、默认 action，并影响 list/view 的过滤。
 * 通常由 AgendaService.inferCategory 根据时间字段推断，LLM 一般不显式传：
 * - 有 action=invoke → Automation
 * - 有 every/cron → Routine
 * - 有 at/after → Reminder
 * - 都没有 → Todo
 */
export enum AgendaCategory {
    /** 普通待办，无时间。LLM 说"我今天要写周报" → Todo。 */
    Todo = 'todo',
    /** 一次性提醒。LLM 说"明天 9 点提醒我开会" → Reminder（带 at）。 */
    Reminder = 'reminder',
    /** 周期任务。LLM 说"每天提醒我喝水" → Routine（带 every）。 */
    Routine = 'routine',
    /** 自动化。LLM 说"每天 8 点帮我总结昨天日志" → Automation（action=invoke）。 */
    Automation = 'automation',
}

/**
 * 完成方式。决定 complete() 工具的行为以及 trigger 触发完是否自动 Done 主体。
 * 由 AgendaService.inferCompletionMode 推断：Todo → Item，其余 → None。
 */
export enum AgendaCompletionMode {
    /**
     * 不需要手动完成。Reminder/Routine/Automation 的默认值。
     * absolute trigger 触发完后系统自动把主体置 Done；周期任务则随 maxFires 耗尽自动 Done。
     */
    None = 'none',
    /**
     * 整条一次性完成。Todo 的默认值。complete() 把主体置 Done，所有 trigger disable。
     */
    Item = 'item',
    /**
     * 每次触发产生一个 occurrence；complete() 只关闭最早的 pending occurrence，主体保留 Pending。
     * 适合"每日喝水打卡"这种"今日完成 ≠ 整条完成"的场景。
     */
    Occurrence = 'occurrence',
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
 * 触发动作。决定 trigger fire 时往会话里送什么。
 */
export enum AgendaTriggerAction {
    /** 默认。发"提醒：${message} (#id)"格式的提示。 */
    Notify = 'notify',
    /** 直接发 message 原文（不加"提醒："前缀）。 */
    Send = 'send',
    /** 把 message 当作用户输入投给 AI 处理。LLM 说"每天 8 点帮我总结" → Invoke。 */
    Invoke = 'invoke',
}

/**
 * Occurrence 状态。仅 Occurrence 完成模式下使用。
 */
export enum AgendaOccurrenceStatus {
    /** 已生成但未确认完成。 */
    Pending = 'pending',
    /** 已完成。 */
    Done = 'done',
    /** 已取消。 */
    Cancelled = 'cancelled',
    /** 被 skipNext 等机制跳过。 */
    Skipped = 'skipped',
}

/**
 * 列表视图。决定 list() 的默认过滤口径。
 */
export enum AgendaListView {
    /** 默认。普通待办视图，排除 Automation。 */
    Todo = 'todo',
    /** 即将到来：仅有 enabled trigger 且有 nextFireAt 的条目。 */
    Upcoming = 'upcoming',
    /** 仅周期任务。 */
    Routine = 'routine',
    /** 仅自动化任务（含任何非 Notify 的 trigger）。 */
    Automation = 'automation',
    /** 全部。 */
    All = 'all',
}

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
 * 相对时间。LLM 说"1 小时后" → { amount: 1, unit: 'hour' }；
 * 说"100 天后" → { amount: 100, unit: 'day' }。
 */
export interface AgendaRelativeTime {
    /** 数量。会被 floor 并取 max(1, ·)，所以传 0/负数会被规范成 1。 */
    amount: number;
    /** 单位。 */
    unit: AgendaTimeUnit;
}

/**
 * 创建参数。LLM 通过 agenda_create 工具调用这个。
 *
 * 时间字段优先级（互斥，按顺序判定）：at > after > every > cron。
 * - at/after → Absolute 一次性 trigger
 * - every    → Interval 周期 trigger
 * - cron     → Cron 周期 trigger
 * - 都没有  → 不创建 trigger（纯 Todo）
 *
 * startAt/startAfter/count 仅对 every/cron 生效（推迟首次 + 限制总次数）。
 */
export interface AgendaCreateArgs {
    /** 主内容。LLM 说"提醒我喝水" → "喝水"。trim 后非空，否则抛错。 */
    content: string;
    /** 显式类别。一般省略，由系统根据时间字段自动推断；显式传可覆盖。 */
    category?: AgendaCategory;
    /** 优先级。默认 Normal。 */
    priority?: AgendaPriority;
    /**
     * 一次性绝对时刻（ISO 字符串）。
     * LLM 说"明天上午 9 点提醒我开会" → at = "2026-06-12T09:00:00"。
     */
    at?: string;
    /**
     * 一次性相对时刻。
     * LLM 说"半小时后提醒我" → after = { amount: 30, unit: 'minute' }。
     */
    after?: AgendaRelativeTime;
    /**
     * 周期间隔。
     * LLM 说"每天提醒我喝水" → every = { amount: 1, unit: 'day' }。
     * 默认无限重复，配合 count 可限定次数。
     */
    every?: AgendaRelativeTime;
    /**
     * 6 字段 cron 表达式（秒 分 时 日 月 周）。
     * LLM 说"工作日早 9 点" → cron = "0 0 9 * * 1-5"。
     */
    cron?: string;
    /**
     * 仅 every/cron 有效：首次触发的绝对时刻。
     * LLM 说"从 9 月 1 日开始每天提醒" → startAt = "2026-09-01T09:00:00"。
     * every：之后按间隔累加；cron：之后按 cron 节奏。
     */
    startAt?: string;
    /**
     * 仅 every/cron 有效：相对 now 推迟首次触发。
     * LLM 说"100 天后开始每天提醒" → startAfter = { amount: 100, unit: 'day' } + every = { amount: 1, unit: 'day' }。
     */
    startAfter?: AgendaRelativeTime;
    /**
     * 仅 every/cron 有效：总触发次数上限；省略=无限。
     * LLM 说"连续提醒 7 天" → count = 7。落到 trigger.maxFires。
     */
    count?: number;
    /**
     * IANA 时区。影响 cron 计算和"今天/明天"的日界判断；缺省取本地时区。
     * 例："Asia/Shanghai" / "America/New_York"。
     */
    timezone?: string;
    /**
     * 触发动作。缺省：Automation 类→Invoke，其余→Notify。
     * LLM 说"每天总结一下" → Invoke。
     */
    action?: AgendaTriggerAction;
    /**
     * 触发时投递的消息文本。缺省=content。
     * LLM 说"每天 9 点用'记得交周报'提醒我" → message = "记得交周报"。
     */
    message?: string;
    /** 显式完成模式。一般省略，由系统按 category 推断。 */
    completionMode?: AgendaCompletionMode;
    /** 来源标记。LLM 调用时一般不传，由 service 根据上下文写入（Tool / Sync）。 */
    source?: AgendaSource;
}

/**
 * 更新参数。LLM 通过 agenda_update 工具调用这个。
 *
 * 时间字段（at/after/every/cron）任一传入都视为"调度变更"：
 * 旧 trigger 全 disable，按新参数建一条新 trigger。
 * timezone/action/message 单独传则在不重建 trigger 的前提下原地改字段。
 */
export interface AgendaUpdatePatch {
    /** 改内容。LLM 说"把 #3 改成 '交月报'" → content = "交月报"。 */
    content?: string;
    category?: AgendaCategory;
    priority?: AgendaPriority;
    completionMode?: AgendaCompletionMode;
    /**
     * 显式改 dueAt（ISO 字符串或 null 清空）。
     * 不传时若发生调度变更，dueAt 由新调度推导。
     */
    dueAt?: string | null;
    /** 重建为 Absolute trigger，见 AgendaCreateArgs.at。 */
    at?: string;
    /** 重建为 Absolute trigger（相对），见 AgendaCreateArgs.after。 */
    after?: AgendaRelativeTime;
    /** 重建为 Interval trigger，见 AgendaCreateArgs.every。 */
    every?: AgendaRelativeTime;
    /** 重建为 Cron trigger，见 AgendaCreateArgs.cron。 */
    cron?: string;
    /** 见 AgendaCreateArgs.startAt。 */
    startAt?: string;
    /** 见 AgendaCreateArgs.startAfter。 */
    startAfter?: AgendaRelativeTime;
    /** 见 AgendaCreateArgs.count。 */
    count?: number;
    /** 改时区；传 null 清空。单独传时不重建 trigger，只改 trigger.timezone 字段。 */
    timezone?: string | null;
    /** 改触发动作。单独传时不重建 trigger。 */
    action?: AgendaTriggerAction;
    /** 改触发消息；传 null 清空回退到 content。单独传时不重建 trigger。 */
    message?: string | null;
}

/**
 * 列表过滤。LLM 通过 agenda_list 工具调用这个。
 */
export interface AgendaListFilter {
    /** 状态过滤。'all' = 不限。缺省 = Pending。 */
    status?: AgendaStatus | 'all';
    /** 仅返回某类别。 */
    category?: AgendaCategory;
    /** 仅返回某优先级。 */
    priority?: AgendaPriority;
    /** 视图过滤。缺省 Todo（排除 Automation）。 */
    view?: AgendaListView;
    /** 上限条数。缺省 50，下限 1。 */
    limit?: number;
}

/**
 * 创建结果。命中近重复时 created=false / existed=true，不会重复建条。
 */
export interface AgendaCreateResult {
    /** 命中重复时返回已存在的视图，否则是新建条目的视图。 */
    item: AgendaItemView;
    /** 是否本次新建。 */
    created: boolean;
    /** 是否命中了 findNearDuplicate（同内容 + 同 dueAt ±2 分钟内的 Pending 项）。 */
    existed: boolean;
}

// ===== Entities =====

/**
 * agenda 主体表行。trigger 与 occurrence 在各自的子表里。
 * 时间戳统一是毫秒（Date.now()），不是秒。
 */
export interface AgendaItem {
    /** 自增主键。LLM 看到的 #1 / #2 / ... 就是这个。 */
    id: number;
    /** 主内容。 */
    content: string;
    status: AgendaStatus;
    priority: AgendaPriority;
    category: AgendaCategory;
    completionMode: AgendaCompletionMode;
    /**
     * 截止时间戳（毫秒）；周期任务为 null。
     * - at 创建：dueAt = at 的时刻
     * - after 创建：dueAt = createdAt + after
     * - every/cron 创建：dueAt = null（"周期"没有截止）
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
    /** IANA 时区；null 表示用本地。 */
    timezone: string | null;
    action: AgendaTriggerAction;
    /** 投递文本，null 时由 fire 时回退到 item.content。 */
    message: string | null;
    /** 投递通道（频道会话 id）。当前由 channelSessionId 注入。 */
    channelHint: number;
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
    /** skipNext 标记的待跳过时刻；触发时若匹配则不实际投递。 */
    skipNextFireAt: number | null;
    /** skipNext 标记的待跳过 fireCount；fireCount 达到时不实际投递。 */
    skipFireCount: number | null;
    createdAt: number;
}

/**
 * 一次"打卡实例"。仅 Occurrence 完成模式下，trigger 每次触发都会 append 一条。
 * 用于支持"每日喝水"这种"完成单次而非整条"的语义。
 */
export interface AgendaOccurrence {
    id: number;
    itemId: number;
    /** 计划触发时刻（毫秒），不一定 = 实际投递时刻。 */
    scheduledAt: number;
    status: AgendaOccurrenceStatus;
    /** 完成时刻；尚未 Done 时为 null。 */
    doneAt: number | null;
}

/**
 * 给上层（list/format/UI）使用的视图：item + 关联 trigger 列表 + 可选 occurrence 列表。
 */
export interface AgendaItemView extends AgendaItem {
    triggers: AgendaTrigger[];
    /** 仅 Occurrence 模式才有意义；其他模式可能为空数组或省略。 */
    occurrences?: AgendaOccurrence[];
}

/**
 * 内部用的"三件套"原始记录，AgendaStore 直接产出，service 内部再 build 成 view。
 */
export interface AgendaRecord {
    item: AgendaItem;
    triggers: AgendaTrigger[];
    occurrences: AgendaOccurrence[];
}
