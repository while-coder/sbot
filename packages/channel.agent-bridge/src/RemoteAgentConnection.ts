import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import type { ILogger } from "channel.base";
import {
  AgentServerMessageType,
  type AgentChatMessage,
  type AgentServerMessage,
  type RemoteToolDefinition,
} from "./protocol";

const TOOL_CALL_TIMEOUT_MS = 120_000;

interface PendingToolCall {
  timer: ReturnType<typeof setTimeout>;
  resolve: (result: ToolCallOutcome) => void;
}

export interface ToolCallOutcome {
  output: string;
  isError: boolean;
}

/** All state for one authenticated external Agent client connection. */
export class RemoteAgentConnection {
  private socket: WebSocket;
  private tools: RemoteToolDefinition[] = [];
  private systemPrompt?: string;
  private readonly pending = new Map<string, PendingToolCall>();

  constructor(socket: WebSocket, private readonly logger?: ILogger) {
    this.socket = socket;
  }

  get alive(): boolean {
    return this.socket.readyState === WebSocket.OPEN;
  }

  get extraInfo(): string {
    const parts: string[] = [];
    if (this.systemPrompt) {
      parts.push("<agent-client-system-prompt>", this.systemPrompt, "</agent-client-system-prompt>");
    }
    return parts.join("\n");
  }

  updateFromChat(message: AgentChatMessage): void {
    this.setTools(message.tools);
    this.systemPrompt = text(message.systemPrompt) || undefined;
  }

  getTools(): RemoteToolDefinition[] {
    return this.tools;
  }

  emit(type: AgentServerMessageType, data?: Record<string, unknown>): void {
    if (!this.alive) return;
    this.socket.send(JSON.stringify({ type, data } satisfies AgentServerMessage));
  }

  callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolCallOutcome> {
    if (!this.alive) {
      return Promise.resolve({ output: "外部客户端已断开，无法执行工具", isError: true });
    }

    const callId = randomUUID();
    return new Promise<ToolCallOutcome>(resolve => {
      const finish = (result: ToolCallOutcome): void => {
        const pending = this.pending.get(callId);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(callId);
        signal?.removeEventListener("abort", onAbort);
        pending.resolve(result);
      };
      const onAbort = (): void => finish({ output: "本轮分析已被取消", isError: true });
      const timer = setTimeout(
        () => finish({ output: `前端在 ${TOOL_CALL_TIMEOUT_MS / 1000} 秒内没有返回 ${name} 的结果`, isError: true }),
        TOOL_CALL_TIMEOUT_MS,
      );
      this.pending.set(callId, { timer, resolve });
      signal?.addEventListener("abort", onAbort, { once: true });
      this.emit(AgentServerMessageType.ToolCall, { callId, name, args });
    });
  }

  receiveToolResult(callId: string, output: string, isError: boolean): void {
    const pending = this.pending.get(callId);
    if (!pending) {
      this.logger?.warn(`Remote agent tool result for unknown callId=${callId}, ignored`);
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(callId);
    pending.resolve({ output, isError });
  }

  failAllPending(reason: string): void {
    for (const [callId, pending] of this.pending) {
      clearTimeout(pending.timer);
      this.pending.delete(callId);
      pending.resolve({ output: reason, isError: true });
    }
  }

  close(): void {
    this.failAllPending("外部客户端连接已关闭");
    try { this.socket.close(); } catch { /* already closed */ }
  }

  private setTools(tools: RemoteToolDefinition[]): void {
    this.tools = tools
      .filter(isAllowedTool)
      .map(tool => ({
        name: tool.name,
        ...(typeof tool.description === "string" && { description: tool.description.trim() }),
        inputSchema: tool.inputSchema,
      }));
  }
}

function isAllowedTool(tool: RemoteToolDefinition | undefined | null): tool is RemoteToolDefinition {
  if (!tool || typeof tool.name !== "string") return false;
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(tool.name)) return false;
  return tool.inputSchema != null && typeof tool.inputSchema === "object" && !Array.isArray(tool.inputSchema);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
