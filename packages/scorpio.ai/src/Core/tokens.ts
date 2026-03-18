/**
 * 通用依赖注入 Token
 * 用于注入配置值和基础参数
 */

export const T_ThreadId = Symbol("scorpio:T_ThreadId");
export const T_UserId = Symbol("scorpio:T_UserId");
export const T_SystemPrompts = Symbol("scorpio:T_SystemPrompts");
export const T_DBPath = Symbol("scorpio:T_DBPath");
export const T_DBUrl = Symbol("scorpio:T_DBUrl");
export const T_SkillsDirs = Symbol("scorpio:T_SkillsDirs");
export const T_SkillDirs = Symbol("scorpio:T_SkillDirs");
export const T_MaxMemoryAgeDays          = Symbol("scorpio:T_MaxMemoryAgeDays");
export const T_MemoryMode                = Symbol("scorpio:T_MemoryMode");
export const T_ExtractorSystemPrompt     = Symbol("scorpio:T_ExtractorSystemPrompt");
export const T_EvaluatorSystemPrompt     = Symbol("scorpio:T_EvaluatorSystemPrompt");
export const T_CompressorPromptTemplate  = Symbol("scorpio:T_CompressorPromptTemplate");
export const T_ReactSystemPromptTemplate = Symbol("scorpio:T_ReactSystemPromptTemplate");
export const T_ReactSubNodePrompt        = Symbol("scorpio:T_ReactSubNodePrompt");
export const T_ReactTaskToolDesc         = Symbol("scorpio:T_ReactTaskToolDesc");
