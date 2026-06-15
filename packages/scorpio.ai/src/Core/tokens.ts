/**
 * 通用依赖注入 Token
 * 用于注入配置值和基础参数
 */

export const T_StaticSystemPrompts = Symbol("scorpio:T_StaticSystemPrompts");
export const T_DynamicSystemPrompts = Symbol("scorpio:T_DynamicSystemPrompts");
export const T_DBPath = Symbol("scorpio:T_DBPath");
export const T_DBUrl = Symbol("scorpio:T_DBUrl");
export const T_DBTable = Symbol("scorpio:T_DBTable");
export const T_ReactSystemPromptTemplate = Symbol("scorpio:T_ReactSystemPromptTemplate");
export const T_ReactSubNodePrompt        = Symbol("scorpio:T_ReactSubNodePrompt");
export const T_ReactTaskToolDesc         = Symbol("scorpio:T_ReactTaskToolDesc");
export const T_SkillSystemPromptTemplate = Symbol("scorpio:T_SkillSystemPromptTemplate");
export const T_SkillToolReadDesc         = Symbol("scorpio:T_SkillToolReadDesc");
export const T_SkillToolListDesc         = Symbol("scorpio:T_SkillToolListDesc");
export const T_SkillToolExecDesc         = Symbol("scorpio:T_SkillToolExecDesc");
export const T_NoteSystemPromptTemplate = Symbol("scorpio:T_NoteSystemPromptTemplate");
/** Note HybridSearcher 的 cachePath（每个 note 一份 searcher.sqlite）。 */
export const T_NoteCachePath            = Symbol("scorpio:T_NoteCachePath");

export const T_ModelCallTimeout           = Symbol("scorpio:T_ModelCallTimeout");
export const T_ToolOverflowDir            = Symbol("scorpio:T_ToolOverflowDir");

// Compact tokens
export const T_CompactPromptTemplate         = Symbol("scorpio:T_CompactPromptTemplate");
export const T_PostCompactMessageTemplate    = Symbol("scorpio:T_PostCompactMessageTemplate");
export const T_PostCompactContinuation       = Symbol("scorpio:T_PostCompactContinuation");
export const T_MaxHistoryRounds              = Symbol("scorpio:T_MaxHistoryRounds");

// Tool description tokens（库内工具描述外置注入）
export const T_NoteToolDescs              = Symbol("scorpio:T_NoteToolDescs");
export const T_WikiToolDescs              = Symbol("scorpio:T_WikiToolDescs");
export const T_MCPUtilityToolDescs        = Symbol("scorpio:T_MCPUtilityToolDescs");
export const T_AgendaExtractorSystemPrompt = Symbol("scorpio:T_AgendaExtractorSystemPrompt");
export const T_AgendaDbPath               = Symbol("scorpio:T_AgendaDbPath");
export const T_AgendaChannelSessionId     = Symbol("scorpio:T_AgendaChannelSessionId");
export const T_AgendaToolDescs            = Symbol("scorpio:T_AgendaToolDescs");

// Memory tokens（skill-style 记忆系统）
export const T_MemoryDir    = Symbol("scorpio:T_MemoryDir");
export const T_MemoryDbPath = Symbol("scorpio:T_MemoryDbPath");
/**
 * 注入到主 agent system prompt 的 memory_read 模板。
 * 占位符 `{{ memory_menu }}` 在 MemoryService 渲染时替换为当前 menu（slug + description 列表）。
 */
export const T_MemoryReadTemplate = Symbol("scorpio:T_MemoryReadTemplate");
/** MemoryWriter LLM 的 system prompt（已加载文件内容）。 */
export const T_MemoryWriterPrompt = Symbol("scorpio:T_MemoryWriterPrompt");
/** MemoryWriter 判断 create/update 时可见的 menu 条目上限。 */
export const T_MemoryMenuMaxEntries = Symbol("scorpio:T_MemoryMenuMaxEntries");
/**
 * 当前 MemoryService 实例对应的 memoryId（pool 装配时注入）。
 * service drain 完成 + 收到 release 请求后，凭这个 id 回调 MemoryServicePool.getInstance().notifyServiceIdle(id)。
 */
export const T_MemoryId = Symbol("scorpio:T_MemoryId");

// Wiki tokens
export const T_WikiSystemPromptTemplate    = Symbol("scorpio:T_WikiSystemPromptTemplate");
/** Wiki HybridSearcher 的 cachePath（单 wikiId 一份 searcher.sqlite）。 */
export const T_WikiCachePath               = Symbol("scorpio:T_WikiCachePath");
