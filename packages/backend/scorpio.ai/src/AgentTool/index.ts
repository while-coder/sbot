/**
 * AgentTool 模块
 * 提供 Agent 工具加载和管理功能
 */

// ===== 接口 + Symbol Token =====
export { IAgentToolService } from "./IAgentToolService";
export type { ProviderResolveEntry } from "./IAgentToolService";

// ===== 实现类 =====
export { AgentToolService } from "./AgentToolService";
export { RecoverableMcpClient, isStaleMcpConnectionError } from "./RecoverableMcpClient";

// ===== 类型定义 =====
export { MCPTransport, MCPServerConfig, MCPServers } from "./MCPServerConfig";
export type { ProviderResult } from "./MCPTypes";

// ===== Utility 工具 =====
