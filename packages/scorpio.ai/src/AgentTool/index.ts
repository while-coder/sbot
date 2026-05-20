/**
 * AgentTool 模块
 * 提供 Agent 工具加载和管理功能
 */

// ===== 接口 + Symbol Token =====
export { IAgentToolService } from "./IAgentToolService";
export type { ProviderResolveEntry } from "./IAgentToolService";

// ===== 实现类 =====
export { AgentToolService } from "./AgentToolService";

// ===== 类型定义 =====
export { MCPServerConfig, MCPServers } from "./MCPServerConfig";
export type { MCPPrompt, MCPPromptMessage, MCPResource, MCPResourceTemplate, MCPResourceContent, ProviderResult } from "./MCPTypes";

// ===== Utility 工具 =====
export { createMCPUtilityTools, type MCPServerCaps, type MCPUtilityToolDescs } from "./MCPUtilityTools";
