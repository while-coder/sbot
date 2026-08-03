import { createServer, type IncomingMessage, type Server } from "node:http";
import { RemoteHttpAgentConnection } from "./RemoteHttpAgentConnection";
import { RemoteAgentService, parseObject, text, type RemoteAgentServiceOptions } from "./RemoteAgentService";
import {
  AgentClientMessageType,
  type AgentChatMessage,
  type AgentSessionIdentity,
  type AgentToolResultMessage,
} from "./protocol";

export interface RemoteHttpAgentServiceOptions extends RemoteAgentServiceOptions {
  port: number;
  host?: string;
}

/** HTTP transport: POST /chat streams SSE; /tool-result and /abort are callbacks. */
export class RemoteHttpAgentService extends RemoteAgentService {
  private readonly connections = new Map<string, RemoteHttpAgentConnection>();
  private server?: Server;

  constructor(private readonly httpOptions: RemoteHttpAgentServiceOptions) {
    super(httpOptions);
  }

  async start(): Promise<void> {
    if (this.server) return;
    const server = this.server = createServer((request, response) => { void this.route(request, response); });
    await new Promise<void>((resolve, reject) => {
      const listening = (): void => { server.off("error", startupError); resolve(); };
      const startupError = (error: Error): void => { server.off("listening", listening); reject(error); };
      server.once("listening", listening);
      server.once("error", startupError);
      server.listen(this.httpOptions.port, this.httpOptions.host);
    });
    server.on("error", error => this.httpOptions.logger?.error(`Remote-agent HTTP server error: ${error.message}`));
    this.httpOptions.logger?.info(`Remote-agent HTTP listening on http://${this.httpOptions.host || "0.0.0.0"}:${this.httpOptions.port}`);
  }

  dispose(): void {
    for (const connection of this.connections.values()) connection.close();
    this.connections.clear();
    this.server?.close();
    this.server = undefined;
  }

  private async route(request: IncomingMessage, response: import("node:http").ServerResponse): Promise<void> {
    this.cors(response);
    if (request.method === "OPTIONS") return void response.writeHead(204).end();
    if (!this.authorized(token(request))) return void response.writeHead(401).end();
    const body = await readBody(request);
    if (!body) return void response.writeHead(400).end();

    if (request.method === "POST" && request.url === "/chat") return this.chat(response, body);
    if (request.method === "POST" && request.url === "/tool-result") return this.toolResult(response, body);
    if (request.method === "POST" && request.url === "/abort") return this.abort(response, body);
    response.writeHead(404).end();
  }

  private chat(response: import("node:http").ServerResponse, body: Record<string, unknown>): void {
    const connection = new RemoteHttpAgentConnection(response, this.httpOptions.logger);
    this.connections.set(connection.requestId, connection);
    response.once("close", () => this.connections.delete(connection.requestId));
    connection.open();
    const message = { ...body, type: AgentClientMessageType.Chat } as AgentChatMessage;
    // 不能在 handleChat 返回时关流：会话把消息投进队列就返回，回复和 done 都还没发出。
    // 响应流由 done / error 事件自己收尾，见 RemoteHttpAgentConnection.send。
    void this.handleChat(connection, message).catch(error => {
      this.httpOptions.logger?.warn(`Remote-agent HTTP chat failed: ${error instanceof Error ? error.message : String(error)}`);
      this.sendError(connection, "请求处理失败");
    });
  }

  private toolResult(response: import("node:http").ServerResponse, body: Record<string, unknown>): void {
    const connection = this.connections.get(text(body.requestId));
    if (!connection) return void response.writeHead(404).end();
    this.handleToolResult(connection, body as unknown as AgentToolResultMessage);
    response.writeHead(204).end();
  }

  private abort(response: import("node:http").ServerResponse, body: Record<string, unknown>): void {
    const connection = this.connections.get(text(body.requestId));
    if (!connection) return void response.writeHead(404).end();
    void this.handleAbort(connection, body as unknown as AgentSessionIdentity).then(
      () => response.writeHead(204).end(),
      () => response.writeHead(500).end(),
    );
  }

  private cors(response: import("node:http").ServerResponse): void {
    response.setHeader("access-control-allow-origin", "*");
    response.setHeader("access-control-allow-headers", "authorization, content-type, x-agent-token");
    response.setHeader("access-control-allow-methods", "POST, OPTIONS");
  }
}

function token(request: IncomingMessage): string {
  const authorization = request.headers.authorization;
  if (typeof authorization === "string" && authorization.startsWith("Bearer ")) return authorization.slice("Bearer ".length);
  return typeof request.headers["x-agent-token"] === "string" ? request.headers["x-agent-token"] : "";
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return parseObject(Buffer.concat(chunks).toString("utf8"));
}
