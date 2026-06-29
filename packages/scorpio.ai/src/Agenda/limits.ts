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
 * sync extractor 喂给 LLM 的 <existing-agenda> 最多列多少条 item。
 * AgendaService.runExtractJob 用它拉记录，AgendaExtractor.extract 内再 slice 兜底——两处共享同一常量。
 */
export const EXISTING_AGENDA_LIMIT = 80;

// ──────────────────────────────────────────────────────────────
// Internal
// ──────────────────────────────────────────────────────────────

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
