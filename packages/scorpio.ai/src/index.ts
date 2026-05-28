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
  T_ReactTaskToolDesc,
  T_SkillSystemPromptTemplate,
  T_SkillToolReadDesc,
  T_SkillToolListDesc,
  T_SkillToolExecDesc,
  T_MemorySystemPromptTemplate,
  T_InsightDir,
  T_InsightLimit,
  T_InsightStaleDays,
  T_InsightArchiveDays,
  T_InsightExtractorSystemPrompt,
  T_InsightSystemPromptTemplate,
  T_WikiSystemPromptTemplate,
  T_ModelCallTimeout,
  T_CompactPromptTemplate,
  T_PostCompactMessageTemplate,
  T_PostCompactContinuation,
  T_MaxHistoryRounds,
  T_MemoryToolDescs,
  T_WikiToolDescs,
  T_MCPUtilityToolDescs,
  T_TodoFilePath,
  T_TodoExtractorSystemPrompt,
  T_TodoToolDescs,
  NowDate,
  sleep,
  parseJson,
  truncate,
  listThreadIds,
  listSubDirs,
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

  // 实现类
  MemoryService,

  // 存储层
  IMemoryDatabase,
  MemorySqliteDatabase,

  // 类型定义
  Memory,
  MEMORY_SEARCH_TOOL_NAME,
  type MemoryToolDescs,
} from "./Memory";

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
  WikiFileDatabase,

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
// Retrieval - 混合检索
// ========================================
export {
  HybridSearcher,
  type SearchableItem,
  type HybridSearchOptions,
} from "./Retrieval";

// ========================================
// Insight - 经验洞察系统
// ========================================
export {
  // 接口 + Symbol Token
  IInsightService,

  // 实现类
  InsightService,

  // 提取器
  IInsightExtractor,
  InsightExtractor,
  type ExtractedInsight,
} from "./Insight";

// ========================================
// Todo - 待办事项系统
// ========================================
export {
  // 接口 + Symbol Token
  ITodoService,

  // 实现类
  TodoService,

  // 提取器
  ITodoExtractor,
  TodoExtractor,
  TodoActionType,
  type Todo,
  type TodoStatus,
  type TodoPriority,
  type TodoListFilter,
  type TodoAction,

  // 工具
  TodoToolProvider,
  TODO_LIST_TOOL_NAME,
  type TodoToolDescs,
} from "./Todo";

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

  // TaskTool
  createTaskTool,
  TASK_TOOL_NAME,
  type TaskToolParams,
  type RunTaskFn,

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
  resolveShell,
  isCommandAvailable,
  validatePath,
  resolveWorkingDir,
  createScriptCodeTool,
  scriptCodeSchema,
  type ScriptCodeToolOptions,
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
export { contentToString, trimContent, isEmptyContent, readImageAsDataUrl, readMediaAsContentPart, detectMediaType, detectImageMimeType, setMaxImageSize, resizeImageIfNeeded } from "./Utils/contentUtils";
export type { MediaCategory } from "./Utils/contentUtils";
export { withRetry } from "./Utils/withRetry";
export { UsageTracker, type UsageData } from "./Utils/UsageTracker";
