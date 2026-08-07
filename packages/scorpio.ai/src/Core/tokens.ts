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

export const T_ModelCallTimeout           = Symbol("scorpio:T_ModelCallTimeout");
export const T_ToolOverflowDir            = Symbol("scorpio:T_ToolOverflowDir");

// Compact tokens
export const T_CompactPromptTemplate         = Symbol("scorpio:T_CompactPromptTemplate");
export const T_PostCompactMessageTemplate    = Symbol("scorpio:T_PostCompactMessageTemplate");
export const T_PostCompactContinuation       = Symbol("scorpio:T_PostCompactContinuation");
export const T_MaxHistoryRounds              = Symbol("scorpio:T_MaxHistoryRounds");

// Tool description tokens（库内工具描述外置注入）
export const T_MCPUtilityToolDescs        = Symbol("scorpio:T_MCPUtilityToolDescs");

/** 当前 channel session 的 DB 主键。注入给 SingleAgentService 和 capability plugins。 */
export const T_ChannelSessionId           = Symbol("scorpio:T_ChannelSessionId");
