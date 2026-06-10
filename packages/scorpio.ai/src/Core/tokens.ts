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
export const T_AgendaSyncSystemPrompt     = Symbol("scorpio:T_AgendaSyncSystemPrompt");
export const T_AgendaProfileDbPath        = Symbol("scorpio:T_AgendaProfileDbPath");
export const T_AgendaProfileId            = Symbol("scorpio:T_AgendaProfileId");
export const T_AgendaChannelSessionId     = Symbol("scorpio:T_AgendaChannelSessionId");
export const T_AgendaToolDescs            = Symbol("scorpio:T_AgendaToolDescs");

export type AgendaProfileDbPathFn = (profileId: number) => string;

// Insight tokens
export const T_InsightDir            = Symbol("scorpio:T_InsightDir");
export const T_InsightLimit          = Symbol("scorpio:T_InsightLimit");
export const T_InsightStaleDays      = Symbol("scorpio:T_InsightStaleDays");
export const T_InsightArchiveDays    = Symbol("scorpio:T_InsightArchiveDays");
export const T_InsightExtractorSystemPrompt = Symbol("scorpio:T_InsightExtractorSystemPrompt");
export const T_InsightSystemPromptTemplate  = Symbol("scorpio:T_InsightSystemPromptTemplate");

// Wiki tokens
export const T_WikiSystemPromptTemplate    = Symbol("scorpio:T_WikiSystemPromptTemplate");
