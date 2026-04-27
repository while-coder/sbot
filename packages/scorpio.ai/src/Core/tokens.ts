/**
 * 通用依赖注入 Token
 * 用于注入配置值和基础参数
 */

export const T_SystemPrompts = Symbol("scorpio:T_SystemPrompts");
export const T_DBPath = Symbol("scorpio:T_DBPath");
export const T_DBUrl = Symbol("scorpio:T_DBUrl");
export const T_DBTable = Symbol("scorpio:T_DBTable");
export const T_MaxMemoryAgeDays          = Symbol("scorpio:T_MaxMemoryAgeDays");
export const T_MemoryMode                = Symbol("scorpio:T_MemoryMode");
export const T_ExtractorSystemPrompt     = Symbol("scorpio:T_ExtractorSystemPrompt");

export const T_CompressorPromptTemplate  = Symbol("scorpio:T_CompressorPromptTemplate");
export const T_ReactSystemPromptTemplate = Symbol("scorpio:T_ReactSystemPromptTemplate");
export const T_ReactSubNodePrompt        = Symbol("scorpio:T_ReactSubNodePrompt");
export const T_ReactTaskToolDesc         = Symbol("scorpio:T_ReactTaskToolDesc");
export const T_SkillSystemPromptTemplate = Symbol("scorpio:T_SkillSystemPromptTemplate");
export const T_SkillToolReadDesc         = Symbol("scorpio:T_SkillToolReadDesc");
export const T_SkillToolListDesc         = Symbol("scorpio:T_SkillToolListDesc");
export const T_SkillToolExecDesc         = Symbol("scorpio:T_SkillToolExecDesc");
export const T_MemorySystemPromptTemplate = Symbol("scorpio:T_MemorySystemPromptTemplate");

export const T_ModelCallTimeout           = Symbol("scorpio:T_ModelCallTimeout");

// Wiki tokens
export const T_WikiExtractorSystemPrompt   = Symbol("scorpio:T_WikiExtractorSystemPrompt");
export const T_WikiSystemPromptTemplate    = Symbol("scorpio:T_WikiSystemPromptTemplate");
export const T_WikiAutoExtract             = Symbol("scorpio:T_WikiAutoExtract");
