/**
 * Core 模块
 *
 * 重新导出 DI 系统和应用级 Token
 */

// DI 系统（从 DI 模块重新导出）
export { ServiceContainer, globalServiceContainer, transient, singleton, inject, init, dispose, InjectionToken, Constructor, AbstractConstructor, Lifecycle, Provider, ClassProvider, FactoryProvider, ValueProvider } from "scorpio.di";

// 通用 Token
export { T_SystemPrompts, T_DBPath, T_DBUrl, T_DBTable, T_MaxMemoryAgeDays, T_MemoryMode, T_ExtractorSystemPrompt, T_CompressorPromptTemplate, T_ReactSystemPromptTemplate, T_ReactSubNodePrompt, T_ReactTaskToolDesc, T_SkillSystemPromptTemplate, T_SkillToolReadDesc, T_SkillToolListDesc, T_SkillToolExecDesc, T_MemorySystemPromptTemplate, T_WikiExtractorSystemPrompt, T_WikiSystemPromptTemplate, T_WikiAutoExtract, T_ModelCallTimeout } from "./tokens";

// 工具函数
export { NowDate, sleep, parseJson, truncate, formatTimeAgo, listThreadIds, listSubDirs } from "./utils";
