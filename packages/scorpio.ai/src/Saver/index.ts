/**
 * Agent Saver 模块
 * 提供对话历史持久化服务
 */

// ===== 接口 + Symbol Token + 中性类型 =====
export { IAgentSaverService, MessageRole, type StoredMessage, type ChatMessage, type ChatToolCall, type ChatMessageOptions, type MessageContent, type TokenUsage } from "./IAgentSaverService";

// ===== LangChain 转换（仅在 Agent 执行层需要） =====
export { toChatMessage, toBaseMessage, toBaseMessages } from "./messageConverter";

// ===== 实现类 =====
export { AgentMemorySaver } from "./AgentMemorySaver";
export { AgentFileSaver } from "./AgentFileSaver";
export { AgentSqliteSaver } from "./AgentSqliteSaver";
export { AgentPostgresSaver } from "./AgentPostgresSaver";
