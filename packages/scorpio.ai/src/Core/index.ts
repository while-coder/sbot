/**
 * Core 模块
 *
 * 重新导出 DI 系统和应用级 Token
 */

// DI 系统（从 DI 模块重新导出）
export { ServiceContainer, globalServiceContainer, transient, singleton, inject, init, dispose, InjectionToken, Constructor, AbstractConstructor, Lifecycle, Provider, ClassProvider, FactoryProvider, ValueProvider } from "scorpio.di";

// 通用 Token
export { T_StaticSystemPrompts, T_DynamicSystemPrompts, T_DBPath, T_DBUrl, T_DBTable, T_ReactSystemPromptTemplate, T_ReactSubNodePrompt, T_ReactTaskToolDesc, T_SkillSystemPromptTemplate, T_SkillToolReadDesc, T_SkillToolListDesc, T_SkillToolExecDesc, T_NoteSystemPromptTemplate, T_MemoryDir, T_MemoryDbPath, T_MemoryReadTemplate, T_WikiSystemPromptTemplate, T_WikiCachePath, T_ModelCallTimeout, T_ToolOverflowDir, T_CompactPromptTemplate, T_PostCompactMessageTemplate, T_PostCompactContinuation, T_MaxHistoryRounds, T_NoteToolDescs, T_WikiToolDescs, T_MCPUtilityToolDescs, T_AgendaExtractorSystemPrompt, T_AgendaDbPath, T_AgendaChannelSessionId, T_AgendaToolDescs } from "./tokens";

// 工具函数
export { parseJson, truncate, listThreadIds, listSubDirs } from "./utils";
