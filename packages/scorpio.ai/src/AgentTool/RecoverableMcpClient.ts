import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { StructuredToolInterface } from "@langchain/core/tools";
import type { ILogger } from "../Logger";

// 远端 MCP 服务（HTTP / SSE / streamable_http）重启 / 进程重建 / 网络抖动后，
// 缓存的 client 上的请求会失败。codex 的设计是在 transport 层精准识别 HTTP 404
// + active session_id，但 langchain mcp-adapters 把 transport 包了一层，HTTP
// 状态码上不来，所以这里覆盖更宽：
//   - JSON-RPC -32602（InvalidParams，常见于 session_id 不识别）/ -32000（ConnectionClosed）
//   - Node 网络层：ECONNRESET / ECONNREFUSED / EPIPE / ENOTFOUND / ETIMEDOUT
//   - undici/fetch：fetch failed / socket hang up / stream closed / 404
export function isStaleMcpConnectionError(err: any): boolean {
    if (!err) return false;
    const code = err.code;
    if (typeof code === 'number' && (code === -32602 || code === -32000)) return true;
    if (typeof code === 'string' && /^(ECONNRESET|ECONNREFUSED|EPIPE|ENOTFOUND|ETIMEDOUT|UND_ERR_SOCKET)$/.test(code)) return true;
    const msg = String(err?.message ?? '');
    return /MCP error -3260[02]|fetch failed|socket hang up|stream (closed|aborted)|terminated|HTTP 404|status:?\s*404/i.test(msg);
}

type ConnectResult = {
    client: MultiServerMCPClient;
    tools: StructuredToolInterface[];
};

type State =
    | { kind: 'idle' }
    | { kind: 'connecting'; promise: Promise<ConnectResult> }
    | { kind: 'ready'; client: MultiServerMCPClient; tools: StructuredToolInterface[]; version: number }
    | { kind: 'closed' };

/**
 * 单个 MCP server 的连接包装，参考 codex 的 RmcpClient
 * （codex-rs/rmcp-client/src/rmcp_client.rs）。
 *
 * 设计要点：
 *   - 显式状态机：idle → connecting → ready → (recovery →) ready → ... → closed
 *   - 原子 swap：recovery 完成后一次性替换 state
 *   - 并发恢复合并：用 promise 链串行化，靠版本号判断"已恢复"，惊群只触发一次重连
 *   - 操作级 retry：getTools / listPrompts / readResource / call_tool 等都走
 *     runOperation；命中 stale 错误自动重连并重试一次（仅一次，与 codex 一致）
 *   - tool 级 retry：getTools 返回的每个 tool 自动通过 wrapTool 路由到 invokeTool，
 *     使工具调用透明地享受 recovery
 */
export class RecoverableMcpClient {
    private state: State = { kind: 'idle' };
    private recoveryQueue: Promise<void> = Promise.resolve();
    private versionCounter = 0;

    /** 连接超时（建立连接 + 拉首次 tool list 的总时长上限）。
     * MCP server "TCP 通了但不响应" 的场景下没这个会让整个 client 死锁。
     * codex 那边靠 initialize_context.timeout 兜底；我们这里硬编码 30s。 */
    private static readonly CONNECT_TIMEOUT_MS = 30_000;

    constructor(
        private readonly name: string,
        private readonly config: any,
        private readonly logger?: ILogger,
    ) {}

    /** 暴露给上层操作的统一入口：保证 state=ready 后取出 client + 当前版本 */
    private async ensureReady(): Promise<{ client: MultiServerMCPClient; version: number }> {
        if (this.state.kind === 'closed') {
            throw new Error(`MCP client "${this.name}" is closed`);
        }
        if (this.state.kind === 'ready') {
            return { client: this.state.client, version: this.state.version };
        }
        if (this.state.kind === 'connecting') {
            await this.state.promise.catch(() => {});
            return this.ensureReady();
        }
        // idle: 启动初次连接
        const promise = this.connect();
        this.state = { kind: 'connecting', promise };
        try {
            const { client, tools } = await promise;
            const cur = this.state as State;
            if (cur.kind === 'closed') {
                client.close().catch(() => {});
                throw new Error(`MCP client "${this.name}" closed during connect`);
            }
            this.state = { kind: 'ready', client, tools, version: ++this.versionCounter };
        } catch (err) {
            if (this.state.kind === 'connecting' && this.state.promise === promise) {
                this.state = { kind: 'idle' };
            }
            throw err;
        }
        return this.ensureReady();
    }

    private async connect(): Promise<ConnectResult> {
        const client = new MultiServerMCPClient({ mcpServers: { [this.name]: this.config } });
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, rej) => {
            timer = setTimeout(
                () => rej(new Error(`MCP "${this.name}" connect timed out after ${RecoverableMcpClient.CONNECT_TIMEOUT_MS}ms`)),
                RecoverableMcpClient.CONNECT_TIMEOUT_MS,
            );
        });
        try {
            const tools = await Promise.race([client.getTools(), timeout]);
            return { client, tools: [...tools] };
        } catch (err) {
            // 超时 / 连接失败：尽力关掉新建的 client，避免泄漏 socket / FD
            client.close().catch(() => {});
            throw err;
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    /** 工具列表（每个 tool.invoke 自带 stale-recovery） */
    async getTools(): Promise<StructuredToolInterface[]> {
        const { client: _c } = await this.ensureReady();
        // ensureReady 之后 state 一定是 ready
        const tools = (this.state as Extract<State, { kind: 'ready' }>).tools;
        return tools.map(t => this.wrapTool(t));
    }

    /** 用包过 stale-recovery 的方式跑一个操作；命中 stale 错误自动重连并重试一次 */
    async runOperation<T>(op: (client: MultiServerMCPClient) => Promise<T>): Promise<T> {
        const { client, version } = await this.ensureReady();
        try {
            return await op(client);
        } catch (err) {
            if (!isStaleMcpConnectionError(err)) throw err;
            this.logger?.warn(`MCP "${this.name}" stale connection (${(err as any)?.message ?? err}); reinitializing`);
            await this.recover(version);
            const after = await this.ensureReady();
            return await op(after.client);
        }
    }

    /**
     * 重连：失效旧 client 并建一个新的。
     *
     * 并发安全：
     *   - 用 recoveryQueue 串行化所有 recover 调用
     *   - 持有 staleVersion；如果当前 ready 的 version 已经变了，说明别的并发
     *     caller 已经完成 recovery，直接返回（"惊群"只实际跑一次）
     */
    private async recover(staleVersion: number): Promise<void> {
        const previous = this.recoveryQueue;
        let release: () => void = () => {};
        this.recoveryQueue = new Promise<void>(r => { release = r; });
        try {
            await previous;
        } catch {}

        try {
            if (this.state.kind === 'closed') {
                throw new Error(`MCP client "${this.name}" is closed`);
            }
            if (this.state.kind === 'ready' && this.state.version !== staleVersion) {
                // 别的 caller 已经恢复完了，本次无需再做
                return;
            }
            if (this.state.kind !== 'ready') {
                // idle / connecting：让 ensureReady 自己处理初次连接
                return;
            }

            const oldClient = this.state.client;
            const { client, tools } = await this.connect();
            // 异步 connect 期间外部可能调过 close()；如果 state 已经是 closed，
            // 不要把它覆盖回 ready，并把新 client 关掉避免泄漏。
            if ((this.state as State).kind === 'closed') {
                client.close().catch(() => {});
                return;
            }
            // 原子 swap：JS 单线程下赋值即原子
            this.state = { kind: 'ready', client, tools, version: ++this.versionCounter };
            // 异步关掉旧 client（不阻塞、不抛错）
            oldClient.close().catch(() => {});
        } finally {
            release();
        }
    }

    private wrapTool(rawTool: StructuredToolInterface): StructuredToolInterface {
        return new Proxy(rawTool, {
            get: (target, prop, receiver) => {
                if (prop !== 'invoke') return Reflect.get(target, prop, receiver);
                return (input: any, config?: any) => this.invokeTool(target.name, input, config);
            },
        });
    }

    private async invokeTool(toolName: string, input: any, config: any): Promise<any> {
        return this.runOperation(async () => {
            // 此时 state 必然是 ready（runOperation 已经 ensureReady）
            const ready = this.state as Extract<State, { kind: 'ready' }>;
            const tool = ready.tools.find(t => t.name === toolName);
            if (!tool) throw new Error(`MCP tool "${toolName}" not found in "${this.name}"`);
            return await tool.invoke(input, config);
        });
    }

    async close(): Promise<void> {
        const old = this.state;
        this.state = { kind: 'closed' };
        if (old.kind === 'ready') {
            await old.client.close().catch(() => {});
        } else if (old.kind === 'connecting') {
            try {
                const { client } = await old.promise;
                await client.close().catch(() => {});
            } catch {}
        }
    }
}
