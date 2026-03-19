import type { Connection } from "@langchain/mcp-adapters";

/**
 * MCP 服务器配置
 * 重新导出 @langchain/mcp-adapters 的 Connection 类型
 *
 * 支持 stdio、http 两种传输方式：
 *
 * **Stdio 方式：**
 * - command: 要运行的可执行文件（如 node、npx、python 等）- 必需
 * - args: 传递给可执行文件的命令行参数
 * - env: 环境变量
 * - cwd: 工作目录
 * - stderr: stderr 处理方式（默认：inherit）
 * - restart: 进程重启配置
 *
 * **HTTP 方式：**
 * - url: 服务器 URL - 必需
 * - headers: 请求头（用于身份验证等）
 * - authProvider: OAuth 认证提供者
 * - reconnect: 重新连接配置
 * - automaticSSEFallback: 是否自动回退到 SSE
 *
 * **工具配置：**
 * - disabled: 禁用的工具列表（这些工具将不会被加载）
 * - defaultToolTimeout: 工具执行的默认超时时间（毫秒）
 *
 * **输出处理：**
 * - outputHandling: 工具输出的处理方式（"content" | "artifact" | 对象）
 */
export type MCPServerConfig = Connection & {
    /** 服务器名称 - 扩展字段 */
    name?: string;
    /** Provider 描述 - 扩展字段 */
    description?: string;
    /** 自动批准的工具列表（无需用户确认） */
    autoApproveTools?: string[];
};

/**
 * MCP 服务器集合
 * Key 为服务器名称，Value 为服务器配置
 */
export interface MCPServers {
    [serverName: string]: MCPServerConfig;
}
