import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { type AgentTool } from "scorpio.llm";
import type { ILogger } from "../Logger";
import { formatError } from "../Core";
import { isStdioConfig, isSseConfig, type MCPServerConfig } from "./MCPServerConfig";
import { listAllTools, wrapMcpTools } from "./McpToolAdapter";

// 远端 MCP 服务（HTTP / SSE / streamable_http）重启 / 进程重建 / 网络抖动后，
// 缓存的 client 上的请求会失败。codex 的设计是在 transport 层精准识别 HTTP 404
// + active session_id；这里覆盖更宽：
//   - SDK 的裸 Error('Not connected')：transport 已关闭（stdio 进程退出等）后发请求
//   - JSON-RPC -32602（InvalidParams，常见于 session_id 不识别）/ -32000（ConnectionClosed）
//   - SDK 的 StreamableHTTPError：code 即 HTTP 状态码（404 等）
//   - Node 网络层：ECONNRESET / ECONNREFUSED / EPIPE / ENOTFOUND / ETIMEDOUT
//   - undici/fetch：fetch failed / socket hang up / stream closed / 404
export function isStaleMcpConnectionError(err: any): boolean {
    if (!err) return false;
    const code = err.code;
    if (typeof code === 'number' && (code === -32602 || code === -32000)) return true;
    if (typeof code === 'string' && /^(ECONNRESET|ECONNREFUSED|EPIPE|ENOTFOUND|ETIMEDOUT|UND_ERR_SOCKET)$/.test(code)) return true;
    const msg = String(err?.message ?? '');
    return /not connected|MCP error -3260[02]|fetch failed|socket hang up|stream (closed|aborted)|terminated|HTTP 404|status:?\s*404/i.test(msg);
}

type ConnectResult = {
    client: Client;
    tools: AgentTool[];
};

/** 连接生命周期状态 */
enum McpState {
    Idle = "idle",
    Connecting = "connecting",
    Ready = "ready",
    Closed = "closed",
}

type State =
    | { kind: McpState.Idle }
    | { kind: McpState.Connecting; promise: Promise<ConnectResult> }
    | { kind: McpState.Ready; client: Client; tools: AgentTool[] }
    | { kind: McpState.Closed };

/** 客户端在 initialize 握手时上报的标识 */
const CLIENT_INFO = { name: "sbot", version: "0.0.1" };

/**
 * 单个 MCP server 的连接包装，参考 codex 的 RmcpClient
 * （codex-rs/rmcp-client/src/rmcp_client.rs），底层直接使用
 * @modelcontextprotocol/sdk 的 Client（不再经由 @langchain/mcp-adapters）。
 *
 * 设计要点：
 *   - 显式状态机：idle → connecting → ready → (recovery →) ready → ... → closed
 *   - 原子 swap：recovery 完成后一次性替换 state
 *   - 并发恢复合并：用 promise 链串行化，靠 client 对象身份判断"已恢复"，
 *     惊群只触发一次重连
 *   - 操作级 retry：runOperation / callTool 命中 stale 错误自动重连并重试一次
 *     （仅一次，与 codex 一致）；工具的 func 经 callTool 回调路由到此处，
 *     故工具调用透明地享受 recovery
 */
export class RecoverableMcpClient {
    private state: State = { kind: McpState.Idle };
    private recoveryQueue: Promise<void> = Promise.resolve();

    /** 连接超时（建立连接 + 拉首次 tool list 的总时长上限）。
     * MCP server "TCP 通了但不响应" 的场景下没这个会让整个 client 死锁。
     * codex 那边靠 initialize_context.timeout 兜底；我们这里硬编码 30s。 */
    private static readonly CONNECT_TIMEOUT_MS = 30_000;

    constructor(
        private readonly name: string,
        private readonly config: MCPServerConfig,
        private readonly logger?: ILogger,
    ) {}

    /** 暴露给上层操作的统一入口：保证 state=ready 后取出当前 client */
    private async ensureReady(): Promise<Client> {
        if (this.state.kind === McpState.Closed) {
            throw new Error(`MCP client "${this.name}" is closed`);
        }
        if (this.state.kind === McpState.Ready) {
            return this.state.client;
        }
        if (this.state.kind === McpState.Connecting) {
            // 直接等发起者的结果（失败也一并传播，避免并发 caller 连环重连）
            await this.state.promise;
            return this.ensureReady();
        }
        // idle: 启动初次连接
        const promise = this.connect();
        this.state = { kind: McpState.Connecting, promise };
        try {
            const { client, tools } = await promise;
            if ((this.state as State).kind === McpState.Closed) {
                client.close().catch(() => {});
                throw new Error(`MCP client "${this.name}" closed during connect`);
            }
            this.state = { kind: McpState.Ready, client, tools };
        } catch (err) {
            if (this.state.kind === McpState.Connecting && this.state.promise === promise) {
                this.state = { kind: McpState.Idle };
            }
            throw err;
        }
        return this.state.client;
    }

    /** 建立并握手一条 transport 连接 */
    private async connectWith(transport: Transport): Promise<Client> {
        const client = new Client(CLIENT_INFO);
        await client.connect(transport);
        return client;
    }

    /** 建立 client 连接：stdio / sse / streamable http（含 4xx 自动回退 SSE） */
    private async connectClient(): Promise<Client> {
        if (isStdioConfig(this.config)) {
            const { command, args, env, cwd, stderr } = this.config;
            return this.connectWith(new StdioClientTransport({
                command,
                args,
                stderr,
                cwd,
                ...env ? { env: { PATH: process.env.PATH ?? "", ...env } } : {},
            }));
        }

        const { url, headers } = this.config;
        const options = headers ? { requestInit: { headers } } : {};

        // 显式 sse：不做 streamable http 尝试
        if (isSseConfig(this.config)) {
            return this.connectWith(new SSEClientTransport(new URL(url), options));
        }

        // streamable http；失败（4xx）时回退 SSE（先原 URL，再 /mcp → /sse 改写后的 URL）
        try {
            return await this.connectWith(new StreamableHTTPClientTransport(new URL(url), options));
        } catch (httpError) {
            if (!this.shouldFallbackToSse(httpError)) throw httpError;
            const sseUrls = [...new Set([url, toSseConnectionUrl(url)])];
            let lastSseError: unknown = httpError;
            for (const sseUrl of sseUrls) {
                try {
                    return await this.connectWith(new SSEClientTransport(new URL(sseUrl), options));
                } catch (sseError) {
                    lastSseError = sseError;
                }
            }
            throw new Error(`Failed to connect to streamable HTTP server "${this.name}", url: ${url}: ${formatError(httpError)}; SSE fallback (${sseUrls.join(" -> ")}) also failed: ${formatError(lastSseError)}`);
        }
    }

    /** streamable http 连接失败（4xx）时是否回退 SSE；可用 automaticSSEFallback: false 关闭 */
    private shouldFallbackToSse(err: any): boolean {
        // isStdioConfig 同时把联合类型收窄到 http 分支（automaticSSEFallback 只在后者存在）
        if (isStdioConfig(this.config)) return false;
        if (this.config.automaticSSEFallback === false) return false;
        const code = err?.code;
        if (typeof code === 'number') return code >= 400 && code < 500;
        const m = String(err?.message ?? '').match(/\(HTTP (\d\d\d)\)/);
        return !!m && Number(m[1]) >= 400 && Number(m[1]) < 500;
    }

    private async connect(): Promise<ConnectResult> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, rej) => {
            timer = setTimeout(
                () => rej(new Error(`MCP "${this.name}" connect timed out after ${RecoverableMcpClient.CONNECT_TIMEOUT_MS}ms`)),
                RecoverableMcpClient.CONNECT_TIMEOUT_MS,
            );
        });
        let client: Client | undefined;
        try {
            client = await Promise.race([this.connectClient(), timeout]);
            const mcpTools = await Promise.race([listAllTools(client), timeout]);
            const tools = wrapMcpTools((n, a, o) => this.callTool(n, a, o), mcpTools);
            return { client, tools };
        } catch (err) {
            // 超时 / 连接失败：尽力关掉新建的 client，避免泄漏 socket / FD
            client?.close().catch(() => {});
            throw err;
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    /** 工具列表（每个 tool 的 func 经 callTool 回调自带 stale-recovery） */
    async getTools(): Promise<AgentTool[]> {
        await this.ensureReady();
        // ensureReady 之后 state 一定是 ready；返回拷贝防调用方原地修改缓存
        const tools = (this.state as Extract<State, { kind: McpState.Ready }>).tools;
        return [...tools];
    }

    /** 用包过 stale-recovery 的方式跑一个操作；命中 stale 错误自动重连并重试一次 */
    async runOperation<T>(op: (client: Client) => Promise<T>): Promise<T> {
        const client = await this.ensureReady();
        try {
            return await op(client);
        } catch (err) {
            if (!isStaleMcpConnectionError(err)) throw err;
            this.logger?.warn(`MCP "${this.name}" stale connection (${formatError(err, true)}); reinitializing`);
            await this.recover(client);
            return await op(await this.ensureReady());
        }
    }

    /** 调用当前连接上的 MCP 工具（自带 stale-recovery），供包装出的工具 func 回调 */
    async callTool(name: string, args: Record<string, any>, options?: { timeout?: number; signal?: AbortSignal }): Promise<CallToolResult> {
        return this.runOperation(client =>
            client.callTool({ name, arguments: args }, undefined, options) as Promise<CallToolResult>);
    }

    /**
     * 重连：失效旧 client 并建一个新的。
     *
     * 并发安全：
     *   - 用 recoveryQueue 串行化所有 recover 调用
     *   - 持有 staleClient；如果当前 ready 的 client 已经不是它，说明别的并发
     *     caller 已经完成 recovery，直接返回（"惊群"只实际跑一次）
     */
    private async recover(staleClient: Client): Promise<void> {
        const previous = this.recoveryQueue;
        let release: () => void = () => {};
        this.recoveryQueue = new Promise<void>(r => { release = r; });
        try {
            await previous;
        } catch {}

        try {
            if (this.state.kind !== McpState.Ready) {
                // closed：报错退出；idle / connecting：让 ensureReady 自己处理连接
                if (this.state.kind === McpState.Closed) {
                    throw new Error(`MCP client "${this.name}" is closed`);
                }
                return;
            }
            if (this.state.client !== staleClient) {
                // 别的 caller 已经恢复完了，本次无需再做
                return;
            }

            const oldClient = this.state.client;
            const { client, tools } = await this.connect();
            // 异步 connect 期间外部可能调过 close()；如果 state 已经是 closed，
            // 不要把它覆盖回 ready，并把新 client 关掉避免泄漏。
            if ((this.state as State).kind === McpState.Closed) {
                client.close().catch(() => {});
                return;
            }
            // 原子 swap：JS 单线程下赋值即原子
            this.state = { kind: McpState.Ready, client, tools };
            // 异步关掉旧 client（不阻塞、不抛错）
            oldClient.close().catch(() => {});
        } finally {
            release();
        }
    }

    async close(): Promise<void> {
        const old = this.state;
        this.state = { kind: McpState.Closed };
        if (old.kind === McpState.Ready) {
            await old.client.close().catch(() => {});
        } else if (old.kind === McpState.Connecting) {
            try {
                const { client } = await old.promise;
                await client.close().catch(() => {});
            } catch {}
        }
    }
}

/** /mcp 结尾的 URL 改写为 /sse（旧版 SSE server 的常见约定） */
function toSseConnectionUrl(url: string): string {
    const urlObj = new URL(url);
    const pathnameParts = urlObj.pathname.split("/");
    if (pathnameParts.at(-1) === "mcp") {
        pathnameParts[pathnameParts.length - 1] = "sse";
        urlObj.pathname = pathnameParts.join("/");
    }
    return urlObj.toString();
}
