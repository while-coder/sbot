import { AgentSession, type AgentSessionOptions } from "./AgentSession.js";
import type { AgentSessionInfo, AgentUserIdentity } from "./protocol.js";
import { ToolRegistry, type ClientTool } from "./ToolRegistry.js";
import type { TransportOptions } from "./transport.js";

export interface RemoteAgentClientOptions {
  /** sbot 上 remote-agent 通道的地址与令牌；每个会话按这份配置各建自己的连接。 */
  connection: Omit<TransportOptions, "onEvent">;
  /** 每轮取一次：谁在用，建议 userId 用设备级或账号级的稳定 ID。 */
  user: () => AgentUserIdentity;
  /** 全部会话共用的客户端工具表；也可以在单个会话上用 session.tools 另外加。 */
  tools?: ToolRegistry | Array<ClientTool<any>>;
  /** 每轮取一次的任务提示词，返回空字符串表示显式清空。 */
  systemPrompt?: (session: AgentSession) => string;
  /** sbot 那台机器上的工作目录，只对本轮生效；返回空则由 sbot 用会话默认目录。 */
  workPath?: (session: AgentSession) => string | undefined;
}

/**
 * 一个 sbot 连接下的会话集合，是本库的入口：连接配置、用户身份、工具表在这里配一次，
 * 每个业务对象用 getSession(sessionId) 拿到自己的会话，各有独立的对话记录。
 *
 * 每个会话独占一条连接（HTTP 是每轮一次请求，WebSocket 是每会话一条 socket），
 * 因为服务端事件不带 sessionId、工具声明和任务提示词也是连接级的，共用连接会串台。
 * 会话是懒建的：没发过消息就不会真的连上 sbot。
 */
export class RemoteAgentClient {
  readonly tools: ToolRegistry;
  private readonly options: RemoteAgentClientOptions;
  private readonly cache = new Map<string, AgentSession>();

  constructor(options: RemoteAgentClientOptions) {
    this.options = options;
    this.tools = options.tools instanceof ToolRegistry ? options.tools : new ToolRegistry(options.tools ?? []);
  }

  /** 已创建的会话，按创建顺序。 */
  get sessions(): readonly AgentSession[] {
    return [...this.cache.values()];
  }

  /**
   * 取（或创建）一个会话。同一个 sessionId 永远返回同一个实例，对话记录因此能留住；
   * 传了 sessionInfo 就顺便更新展示信息（业务对象改名时用得上）。
   */
  getSession(sessionId: string, sessionInfo?: AgentSessionInfo): AgentSession {
    const id = sessionId.trim();
    if (!id) throw new Error("sessionId 不能为空");
    const existing = this.cache.get(id);
    if (existing) {
      if (sessionInfo) existing.setSessionInfo(sessionInfo);
      return existing;
    }
    const session: AgentSession = new AgentSession(this.sessionOptions(id, sessionInfo, () => session));
    this.cache.set(id, session);
    return session;
  }

  has(sessionId: string): boolean {
    return this.cache.has(sessionId.trim());
  }

  /** 关掉一个会话并丢弃它的对话记录；之后同名 getSession 会拿到一个全新的会话。 */
  closeSession(sessionId: string): void {
    const id = sessionId.trim();
    const session = this.cache.get(id);
    if (!session) return;
    this.cache.delete(id);
    session.dispose();
  }

  /** 关掉全部会话与连接。 */
  dispose(): void {
    for (const session of this.cache.values()) session.dispose();
    this.cache.clear();
  }

  /**
   * 每个会话一份传输，工具表共用（工具是「客户端此刻能做什么」，与会话无关）。
   * self 是个惰性取值：回调要带上会话本身，而会话在这份选项构造完之后才存在。
   */
  private sessionOptions(sessionId: string, sessionInfo: AgentSessionInfo | undefined, self: () => AgentSession): AgentSessionOptions {
    const { connection, user, systemPrompt, workPath } = this.options;
    return {
      // 给配置而不是传输实例：会话自己建连接、自己接管事件，也就自己负责在 dispose 时关掉。
      transport: connection,
      sessionId,
      ...(sessionInfo && { sessionInfo }),
      user,
      tools: this.tools,
      ...(systemPrompt && { systemPrompt: () => systemPrompt(self()) }),
      ...(workPath && { workPath: () => workPath(self()) }),
    };
  }
}
