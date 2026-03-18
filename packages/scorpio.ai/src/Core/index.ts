/**
 * Core 模块
 *
 * 重新导出 DI 系统和应用级 Token
 */

// DI 系统（从 DI 模块重新导出）
export { ServiceContainer, globalServiceContainer, transient, singleton, inject, init, dispose, InjectionToken, Constructor, AbstractConstructor, Lifecycle, Provider, ClassProvider, FactoryProvider, ValueProvider } from "../DI";

// 通用 Token
export { T_ThreadId, T_UserId, T_SystemPrompts, T_DBPath, T_DBUrl, T_SkillsDirs, T_SkillDirs, T_MaxMemoryAgeDays, T_MemoryMode, T_ExtractorSystemPrompt, T_EvaluatorSystemPrompt, T_CompressorPromptTemplate, T_ReactSystemPromptTemplate, T_ReactSubNodePrompt, T_ReactTaskToolDesc } from "./tokens";

// 工具函数
export { NowDate, sleep, parseJson, truncate } from "./utils";
