/**
 * MCP 服务器配置
 *
 * 原先 re-export @langchain/mcp-adapters 的 Connection 类型；迁移到原生
 * @modelcontextprotocol/sdk 后改为自建类型，字段与既有用户配置完全兼容
 * （type / transport 两种写法均接受，缺省时按结构推断：有 command → stdio，有 url → http）。
 *
 * 支持 stdio、http 两种传输方式：
 *
 * **Stdio 方式：**
 * - command: 要运行的可执行文件（如 node、npx、python 等）- 必需
 * - args: 传递给可执行文件的命令行参数 - 必需
 * - env: 环境变量
 * - cwd: 工作目录
 * - stderr: stderr 处理方式（默认：inherit）
 *
 * **HTTP 方式：**
 * - url: 服务器 URL - 必需
 * - headers: 请求头（用于身份验证等）
 * - automaticSSEFallback: streamable HTTP 连接失败（4xx）时是否自动回退到 SSE（默认：true）
 * - type/transport 为 MCPTransport.Sse 时直接走 SSE，不做 streamable HTTP 尝试
 *
 * **扩展字段：**
 * - name: 服务器名称
 * - description: Provider 描述
 * - enablePromptTools: 启用 prompts utility tools 生成（默认不启用）
 * - enableResourceTools: 启用 resources utility tools 生成（默认不启用）
 */

/**
 * MCP 传输方式。枚举值为字符串，与既有 JSON 配置中的 type/transport 字段直接兼容。
 */
export enum MCPTransport {
    /** 本地子进程（command + args） */
    Stdio = "stdio",
    /** 远程 streamable HTTP（连接失败时可自动回退 SSE） */
    Http = "http",
    /** 远程 SSE（旧版传输协议） */
    Sse = "sse",
}

export type MCPStdioConfig = {
    transport?: MCPTransport.Stdio;
    type?: MCPTransport.Stdio;
    command: string;
    args: string[];
    env?: Record<string, string>;
    cwd?: string;
    stderr?: "overlapped" | "pipe" | "ignore" | "inherit";
};

export type MCPHttpConfig = {
    transport?: MCPTransport.Http | MCPTransport.Sse;
    type?: MCPTransport.Http | MCPTransport.Sse;
    url: string;
    headers?: Record<string, string>;
    /** streamable HTTP 连接失败（4xx）时自动回退到 SSE */
    automaticSSEFallback?: boolean;
};

export type MCPServerConfig = (MCPStdioConfig | MCPHttpConfig) & {
    /** 服务器名称 - 扩展字段 */
    name?: string;
    /** Provider 描述 - 扩展字段 */
    description?: string;
    /** 启用 prompts utility tools 生成（默认不启用） */
    enablePromptTools?: boolean;
    /** 启用 resources utility tools 生成（默认不启用） */
    enableResourceTools?: boolean;
};

/**
 * 判定配置是否为 stdio 传输（有 command 即视为 stdio，与 mcp-adapters 的推断一致）
 */
export function isStdioConfig(config: MCPServerConfig): config is MCPStdioConfig {
    const transport = (config as MCPStdioConfig).transport ?? (config as MCPStdioConfig).type;
    if (transport === MCPTransport.Stdio) return true;
    return typeof (config as MCPStdioConfig).command === "string";
}

/**
 * 判定配置是否显式要求 SSE 传输
 */
export function isSseConfig(config: MCPHttpConfig): boolean {
    return config.transport === MCPTransport.Sse || config.type === MCPTransport.Sse;
}

/**
 * MCP 服务器集合
 * Key 为服务器名称，Value 为服务器配置
 */
export interface MCPServers {
    [serverName: string]: MCPServerConfig;
}
