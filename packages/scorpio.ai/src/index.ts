/**
 * scorpio.ai - Core AI Infrastructure Library
 *
 * 提供 AI Agent 的核心基础设施：
 * - DI: 依赖注入容器
 * - Core: 通用 Token
 * - Model: LLM 模型服务
 * - Embedding: 文本嵌入服务
 * - Note: 笔记/资料库系统（向量检索）
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
} from "scorpio.di";

// ========================================
// Core - 通用 Token
// ========================================
export {
  T_StaticSystemPrompts,
  T_DynamicSystemPrompts,
  T_DBPath,
  T_DBUrl,
  T_DBTable,
  T_ReactSystemPromptTemplate,
  T_ReactSubNodePrompt,
  T_SkillSystemPromptTemplate,
  T_SkillToolReadDesc,
  T_SkillToolListDesc,
  T_SkillToolExecDesc,
  T_NoteSystemPromptTemplate,
  T_NoteCachePath,
  T_MemoryDir,
  T_MemoryDbPath,
  T_MemoryReadTemplate,
  T_MemoryWriterPrompt,
  T_WikiSystemPromptTemplate,
  T_WikiCachePath,
  T_ModelCallTimeout,
  T_ToolOverflowDir,
  T_CompactPromptTemplate,
  T_PostCompactMessageTemplate,
  T_PostCompactContinuation,
  T_MaxHistoryRounds,
  T_NoteToolDescs,
  T_WikiToolDescs,
  T_MCPUtilityToolDescs,
  T_AgendaExtractorSystemPrompt,
  T_AgendaDbPath,
  T_AgendaToolDescs,
  T_ChannelSessionId,
  parseJson,
  truncate,
  listThreadIds,
  listSubDirs,
  formatError,
  runtimeActivity,
} from "./Core";

// ========================================
// Model - 模型服务
// ========================================
export {
  // 接口 + DI Token + 公共基类
  IModelService,
  ModelServiceBase,

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
// Note - 笔记/资料库系统
// ========================================
export {
  // 接口 + Symbol Token
  INoteService,

  // 实现类
  NoteService,

  // 存储层
  INoteDatabase,
  NoteSqliteDatabase,

  // 类型定义
  Note,
  NOTE_SEARCH_TOOL_NAME,
  type NoteToolDescs,
} from "./Note";

// ========================================
// Wiki - 知识库系统
// ========================================
export {
  // 接口 + Symbol Token
  IWikiService,

  // 实现类
  WikiService,

  // 存储层
  IWikiDatabase,

  // 工具
  WikiToolProvider,
  WIKI_SEARCH_TOOL_NAME,
  WIKI_READ_TOOL_NAME,
  type WikiToolDescs,

  // 类型定义
  WikiPage,
} from "./Wiki";

// ========================================
// Saver - 状态持久化
// ========================================
export {
  // 接口 + Symbol Token
  IAgentSaverService,
  MessageKind,
  type StoredMessage,
  type NewStoredMessage,
  type ChatToolCall,
  type MessageContent,
  type TokenUsage,

  // ContentPart 判别联合
  ContentPartType,
  type ContentPart,

  // 实现类
  AgentMemorySaver,
  AgentFileSaver,
  AgentSqliteSaver,
  AgentPostgresSaver,

  // Compact
  ConversationCompactor,
  IConversationCompactor,
} from "./Saver";

// ========================================
// Skills - 技能系统
// ========================================
export {
  // 接口 + Symbol Token
  ISkillService,

  // 实现类
  SkillService,
  READ_SKILL_FILE_TOOL_NAME,
  EXECUTE_SKILL_SCRIPT_TOOL_NAME,
  LIST_SKILL_FILES_TOOL_NAME,

  // 类型定义
  Skill,
} from "./Skills";

// ========================================
// Retrieval - 混合检索（BM25 + jaccard + embedding，自管 SQLite 缓存）
// ========================================
export {
  HybridSearcher,
  type HybridSearcherOptions,
} from "./Retrieval";

// ========================================
// Memory - 长期记忆（skill 风格 + MemoryLLM CRUD + FTS5 检索）
// ========================================
export {
  IMemoryStore,
  MemoryStore,
  MemoryOpAction,
  MemoryOpSchema,
  MemoryWriteOutputSchema,
  IMemoryService,
  MemoryService,
  MemoryServicePool,
  memoryServicePool,
  MemoryToolProvider,
  READ_MEMORY_TOOL_NAME,
  SEARCH_MEMORY_TOOL_NAME,
  MemoryKind,
  type MemoryRow,
  type MemoryBodyMode,
  type MemoryMenuEntry,
  type MemorySearchHit,
  type CreateMemoryInput,
  type UpdateMemoryInput,
  MemoryPendingJobType,
  type PendingMemoryJobRow,
  type MemoryPendingJobStatus,
  type MemoryWriteOutput,
  type MemoryOp,
  type MemoryWriterOpStats,
  type MemoryServiceConfig,
  type MemoryServiceConfigResolver,
  type MemoryToolDescs,
} from "./Memory";

// ========================================
// Agenda - 统一事项系统
// ========================================
export {
  IAgendaService,
  IAgendaStore,
  IAgendaTriggerEngine,
  AgendaService,
  AgendaServicePool,
  agendaServicePool,
  AgendaStore,
  AgendaExtractor,
  IAgendaExtractor,
  AgendaToolProvider,
  AGENDA_CREATE_TOOL_NAME,
  AGENDA_LIST_TOOL_NAME,
  AGENDA_UPDATE_TOOL_NAME,
  AGENDA_COMPLETE_TOOL_NAME,
  AGENDA_CANCEL_TOOL_NAME,
  AgendaStatus,
  AgendaPriority,
  AgendaSource,
  AgendaTriggerKind,
  AgendaTriggerAction,
  AgendaTimeUnit,
  AgendaPendingJobType,
  type AgendaCreateArgs,
  type AgendaCreateResult,
  type AgendaRelativeTime,
  type AgendaUpdatePatch,
  type AgendaListFilter,
  type AgendaItem,
  type AgendaTrigger,
  type AgendaTriggerFire,
  type AgendaToolDescs,
  type AgendaAction,
  type AgendaRecord,
  type AgendaServiceConfig,
  type AgendaServiceConfigResolver,
  type PendingAgendaJobRow,
  type AgendaPendingJobStatus,
  AgendaActionType,
  computeInitialNextFire,
  computeNextAfterFire,
  relativeToMs,
  DEFAULT_GRACE_MS,
} from "./Agenda";

// ========================================
// Trigger - 通用 session 投递语义
// ========================================
export { SessionDeliveryMode } from "./Trigger";

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

  // 元数据访问器
  getCommandMetadata,
} from "./Command";
export type { CommandMetadata, ArgMetadata, OptionMetadata } from "./Command";

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
  createMCPUtilityTools,
  type MCPServerCaps,
  type MCPUtilityToolDescs,
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
  GenerativeAgentService,
  ACPAgentServiceBase,
  TransientACPAgentService,
  PersistentACPAgentService,

  // Token
  T_AgentSubNodes,
  T_CreateAgent,
  T_ThinkModelService,
  T_SummaryModelService,
  T_ACPCommand,
  T_ACPArgs,
  T_ACPEnv,
  T_ACPWorkPath,
  T_ACPInitTimeout,

  // 类型定义
  GraphNodeType,
  ToolApproval,
  ChatMessage,
  MessageRole,
  IAgentCallback,
  AgentCancelledError,
} from "./Agents";

export type {
  AgentSubNode,
  CreateAgentFn,
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
  MCPDocumentContent,
  MCPImageUrlContent,
  MCPContent,
  MCPToolResult,
  MCPToolResultMeta,

  // Dispatch task tool
  createDispatchTaskTool,
  DISPATCH_TASK_TOOL_NAME,
  type DispatchTaskToolParams,
  type RunDispatchTaskFn,

  // 工具函数
  createTextContent,
  createImageContent,
  createAudioContent,
  createDocumentContent,
  createSuccessResult,
  createErrorResult,
  isMCPToolResult,
  normalizeToMCPResult,

  // Process - 子进程执行框架
  runProgram,
  runShellCommand,
  getCurrentShell,
  isCommandAvailable,
  validatePath,
  resolveWorkingDir,
  createShellTool,
  createReadProcessTool,
  createWriteProcessTool,
  shellToolSchema,
  readProcessToolSchema,
  writeProcessToolSchema,
  CodeRuntime,
  CodeToolMode,
  ShellToolMode,
  ScriptCodeMode,
  type ShellToolOptions,
  type ReadProcessToolOptions,
  type WriteProcessToolOptions,
  createScriptCodeTool,
  scriptCodeSchema,
  type ScriptCodeToolOptions,
  ProcessManager,
  processManager,
  formatProcessResult,
  type ManagedProcessResult,
  MAX_OUTPUT_BYTES,

  // 文件系统遍历
  walkTree,
  formatWalkSummary,
  formatWalkTree,
  DEFAULT_WALK_MAX_DEPTH,
  DEFAULT_WALK_LIMIT,
  type WalkTreeOptions,
  type WalkTreeResult,
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

// ========================================
// User - 用户服务基类
// ========================================
export { MessageDispatcher, MessageType, summarizeMultimodal } from "./User";

// ========================================
// Utils - 工具函数
// ========================================
export { contentToString, trimContent, isEmptyContent, readImageAsDataUrl, readMediaAsContentPart, detectMediaType, detectImageMimeType, setMaxImageSize } from "./Utils/contentUtils";
export type { MediaCategory } from "./Utils/contentUtils";
export { withRetry } from "./Utils/withRetry";
export { UsageTracker, type UsageData } from "./Utils/UsageTracker";
export { TimeUtils } from "./Utils/TimeUtils";
export { renderConversation } from "./Utils/conversationUtils";
