/**
 * scorpio.ai - Core AI Infrastructure Library
 *
 * 提供 AI Agent 的核心基础设施：
 * - DI: 依赖注入容器
 * - Core: 通用 Token
 * - Model: LLM 模型服务
 * - Embedding: 文本嵌入服务
 * - Memory: 长期记忆系统
 * - Saver: Agent 状态持久化
 * - Skills: 技能系统
 * - Command: 命令系统（装饰器、解析器）
 * - AgentTool: 工具管理
 * - Agent: Agent 服务
 * - Tools: MCP 标准类型
 * - Logger: 日志服务
 */

// ========================================
// DI - 依赖注入
// ========================================
export {
  // 容器类
  ServiceContainer,
  globalServiceContainer,

  // 装饰器
  transient,
  singleton,
  inject,
  init,
  dispose,

  // 类型定义
  InjectionToken,
  Constructor,
  AbstractConstructor,
  Lifecycle,
  Provider,
  ClassProvider,
  FactoryProvider,
  ValueProvider,
} from "./DI";

// ========================================
// Core - 通用 Token
// ========================================
export {
  T_ThreadId,
  T_UserId,
  T_SystemPrompts,
  T_DBPath,
  T_DBUrl,
  T_SkillsDirs,
  T_SkillDirs,
  T_MaxMemoryAgeDays,
  T_MemoryMode,
} from "./Core";

// ========================================
// Model - 模型服务
// ========================================
export {
  // 接口 + Symbol Token
  IModelService,

  // 实现类
  OpenAIModelService,

  // 工厂和配置
  ModelServiceFactory,

  // 类型定义
  ModelConfig,
  ModelProvider,
} from "./Model";

// ========================================
// Embedding - 向量化服务
// ========================================
export {
  // 接口 + Symbol Token
  IEmbeddingService,

  // 实现类
  OpenAIEmbeddingService,

  // 工厂和配置
  EmbeddingServiceFactory,

  // 类型定义
  EmbeddingConfig,
  EmbeddingProvider,
} from "./Embedding";

// ========================================
// Memory - 记忆系统
// ========================================
export {
  // 接口 + Symbol Token
  IMemoryService,
  IMemoryExtractor,
  IMemoryEvaluator,
  IMemoryCompressor,

  // 实现类
  MemoryNoneService,
  ReadOnlyMemoryService,
  MemoryService,
  MemoryExtractor,
  MemoryEvaluator,
  MemoryCompressor,

  // 存储层
  IMemoryDatabase,
  MemorySqliteDatabase,

  // 类型定义
  Memory,
  MemoryMetadata,
  MemoryRetrievalOptions,
  MemorySearchResult,
  MemoryMode,
  ExtractionResult,
  EvaluationResult,
  CompressionResult,
  MergeStrategy,
} from "./Memory";

// ========================================
// Saver - 状态持久化
// ========================================
export {
  // 接口 + Symbol Token
  IAgentSaverService,

  // 实现类
  AgentMemorySaver,
  AgentSqliteSaver,
  AgentPostgresSaver,
} from "./Saver";

// ========================================
// Skills - 技能系统
// ========================================
export {
  // 接口 + Symbol Token
  ISkillService,

  // 实现类
  SkillService,

  // 类型定义
  Skill,
  SkillMetadata,
} from "./Skills";

// ========================================
// Command - 命令系统
// ========================================
export {
  // 装饰器
  Command,
  Arg,
  Option,

  // 解析器
  Parsers,

  // 接口和类
  ICommand,
  CommandContext,
  CommandRegistry,
} from "./Command";

// ========================================
// AgentTool - 工具管理
// ========================================
export {
  // 接口 + Symbol Token
  IAgentToolService,

  // 实现类
  AgentToolService,

  // 类型定义
  MCPServerConfig,
  MCPServers,
} from "./AgentTool";

// ========================================
// Agent - Agent 服务
// ========================================
export {
  // 基类
  AgentServiceBase,

  // 服务类
  SingleAgentService,
  ReActAgentService,
  SupervisorAgentService,

  // ReAct Token
  T_AgentSubNodes,
  T_MaxIterations,
  T_CreateAgent,
  T_ThinkAgentName,
  T_ReflectModelService,
  T_SummaryModelService,

  // Supervisor Token
  T_SupervisorSubNodes,
  T_SupervisorMaxRounds,
  T_SupervisorAgentName,
  T_FinalizeModelService,

  // 类型定义
  MessageChunkType,
  GraphNodeType,
  AgentToolCall,
  AgentMessage,
  IAgentCallback,
} from "./Agents";

export type {
  AgentSubNode,
  CreateAgentFn,
  ReActStep,
  ReActState,
  SupervisorState,
} from "./Agents";

// ========================================
// Tools - MCP 标准类型
// ========================================
export {
  // 类型定义
  MCPContentType,
  MCPTextContent,
  MCPImageContent,
  MCPAudioContent,
  MCPImageUrlContent,
  MCPCustomImageUrlContent,
  MCPContent,
  MCPToolResult,

  // 工具函数
  createTextContent,
  createImageContent,
  createAudioContent,
  createSuccessResult,
  createErrorResult,
  isMCPToolResult,
  normalizeToMCPResult,
} from "./Tools";

// ========================================
// Logger - 日志服务
// ========================================
export {
  // 接口 + Symbol Token
  ILogger,
  ILoggerService,

  // 全局单例
  GlobalLoggerService,
} from "./Logger";
