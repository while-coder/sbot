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
  T_ReactSystemPromptTemplate,
  T_ReactSubNodePrompt,
  T_ModelCallTimeout,
  T_ToolOverflowDir,
  T_CompactPromptTemplate,
  T_PostCompactMessageTemplate,
  T_PostCompactContinuation,
  T_MaxHistoryRounds,
  T_MCPUtilityToolDescs,
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

  // 工厂和配置
  EmbeddingServiceFactory,

  // 类型定义
  EmbeddingConfig,
  EmbeddingProvider,
} from "./Embedding";

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
  type AttachmentInput,
  type TokenUsage,

  // ContentPart 判别联合
  ContentPartType,
  type ContentPart,

  AgentMemorySaver,
  TaskBackedSaver,
  estimateTextTokens,
  estimateMessageTokens,
  estimateMessagesTokens,
} from "scorpio.saver";

export {
  ConversationCompactor,
  IConversationCompactor,
  METADATA_KEY_INPUT_TOKENS,
} from "./Conversation";

// ========================================
// Retrieval - 混合检索（BM25 + jaccard + embedding，自管 SQLite 缓存）
// ========================================
export {
  HybridSearcher,
  type HybridSearcherOptions,
} from "./Retrieval";

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
  MCPTransport,
  MCPServerConfig,
  MCPServers,
  createMCPUtilityTools,
  type MCPServerCaps,
  type MCPUtilityToolDescs,
} from "./AgentTool";

// ========================================
// Tools - 轻量结构化工具（全项目工具边界，替代 @langchain/core 的工具抽象）
// ========================================
export {
  createAgentTool,
  toOpenAIToolFormat,
  type AgentTool,
  type ToolInvokeConfig,
  type ToolDefinition,
} from "scorpio.llm";

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

  // 能力插件（system prompt + 工具 + turn 末尾副作用的可插拔单元）
  IAgentPlugin,
  AgentPluginPromptKind,
} from "./Agents";

export type {
  AgentSubNode,
  CreateAgentFn,
  OnCreateThinkFn,
  AgentPluginContext,
  AgentTurn,
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
  type RunDispatchTaskArgs,
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
export { contentToString, truncateForLog, trimContent, isEmptyContent, readImageAsDataUrl, readMediaAsContentPart, detectMediaType, detectImageMimeType, setMaxImageSize, appendAttachmentsToMessageContent, writeAttachmentInput } from "./Utils/contentUtils";
export type { MediaCategory } from "./Utils/contentUtils";
export { withRetry } from "./Utils/withRetry";
export { UsageTracker, UsageState, type UsageData } from "./Utils/UsageTracker";
export { TimeUtils } from "./Utils/TimeUtils";
export { renderConversation } from "./Utils/conversationUtils";
