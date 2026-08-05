/**
 * Agenda 系统所有列表 / 分页 / 截断常量集中管理。
 *
 * 分两类：
 * - LLM-facing：直接影响给 LLM 看到的内容；调整需同步评估 prompt 描述。
 * - Internal：DB / admin / 防御性裁剪；调整对 LLM 行为透明。
 */

// ──────────────────────────────────────────────────────────────
// LLM-facing
// ──────────────────────────────────────────────────────────────

/**
 * agenda_list 工具默认返回条数（buildList 在 caller 没传 limit 时用）。
 * 改这个值要顺手更新 [tools/list.txt] 提示中的 "limit — default N"。
 */
export const DEFAULT_LIST_LIMIT = 50;

/**
 * compact 模式下 trigger.message 保留的字符数，超出截断加省略号。
 * agenda_list 用它——invoke 类 trigger 的 message 是完整执行指令（动辄几千字），
 * 主 agent 列清单时只需要够区分"哪条 trigger"，全文只会挤占上下文。
 * sync extractor 走 full 模式不受影响（它要靠原文判断措辞是否需要改写）。
 */
export const AGENDA_MESSAGE_PREVIEW_LEN = 60;

/**
 * agenda_get fires=true 时回给 LLM 的触发历史条数（按 firedAt DESC 取最近的）。
 * 够回答"最近跑了吗 / 上几次成功吗"，再多就是审计需求——那是 admin UI 的事。
 */
export const DETAIL_FIRES_LIMIT = 5;

// ──────────────────────────────────────────────────────────────
// Internal
// ──────────────────────────────────────────────────────────────

/**
 * 每个 item 最多保留多少条 trigger_fire 日志（按 firedAt 取最近的）。
 * insertTriggerFire 写入后裁掉超出的最旧记录，防止高频无限 trigger 让日志无界增长。
 */
export const MAX_TRIGGER_FIRES_PER_ITEM = 200;

/**
 * listTriggerFires（admin 查看触发历史）的默认返回条数。
 * 不传 limit 时用它；任何 caller 传更大的值都被截到 MAX_TRIGGER_FIRES_PER_ITEM
 * （单 item 的留存上限，再多也没有）。
 */
export const DEFAULT_TRIGGER_FIRES_LIMIT = 100;

/**
 * IAgendaService.listPending / admin listPendingJobs 的默认 limit。
 * 配合 PENDING_JOB_LIST_HARD_CAP 一起生效。
 */
export const DEFAULT_PENDING_JOB_LIMIT = 50;

/**
 * AgendaStore.listPendingJobs 的硬防御上限——任何 caller 传更大的 limit 都被截到这里。
 */
export const PENDING_JOB_LIST_HARD_CAP = 200;

/**
 * pending job 行 errorMessage 字段的最大字符数。防 stack trace 写满表。
 */
export const ERROR_MESSAGE_MAX_LEN = 1000;
