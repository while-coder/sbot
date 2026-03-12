import "reflect-metadata";
import { AgentMessage, AgentToolCall, MCPToolResult } from "scorpio.ai";
import { WebSocket } from "ws";
import { AgentRunner } from "../Agent/AgentRunner";
import { config } from '../Core/Config';

export type WebChatEvent =
    | { type: "stream"; content: string }
    | { type: "message"; role: string; content?: string; tool_calls?: any[]; tool_call_id?: string }
    | { type: "tool_call"; id?: string; name: string; args: Record<string, any> }
    | { type: "done" }
    | { type: "error"; message: string };

export class WebSocketUserService {
    private activeWs: WebSocket | null = null;

    private setWs(ws: WebSocket): void {
        this.activeWs = ws;
        if (ws) {
            ws.on('close', () => {
                if (this.activeWs === ws) this.clearWs();
            });
        }
    }

    private clearWs(): void {
        this.activeWs = null;
    }

    // ===== Called by UserService =====

    async startProcessMessage(_query: string, args: any): Promise<string> {
        if (args?.ws) this.setWs(args.ws);
        return '';
    }

    async onMessageProcessed(): Promise<void> {
        this.emit({ type: 'done' });
        this.clearWs();
    }

    async processMessageError(e: any): Promise<void> {
        this.emit({ type: 'error', message: e.message });
        this.clearWs();
    }

    async onAgentMessage(message: AgentMessage): Promise<void> {
        this.emit({
            type: 'message',
            role: message.type,
            content: message.content,
            tool_calls: message.tool_calls,
            tool_call_id: message.tool_call_id,
        });
    }

    async onAgentStreamMessage(message: AgentMessage): Promise<void> {
        this.emit({ type: 'stream', content: message.content ?? '' });
    }

    async executeAgentTool(toolCall: AgentToolCall): Promise<boolean> {
        this.emit({ type: 'tool_call', id: toolCall.id, name: toolCall.name, args: toolCall.args });
        return true;
    }

    async askUser(_question: string): Promise<string> {
        return '';
    }

    async processAIMessage(query: string, args: any): Promise<void> {
        const callbacks = {
            onMessage: this.onAgentMessage.bind(this),
            onStreamMessage: this.onAgentStreamMessage.bind(this),
            executeTool: this.executeAgentTool.bind(this),
            convertImages: async (r: MCPToolResult) => r,
        };
        const sessionId = args?.sessionId as string;
        const session = sessionId ? config.getSession(sessionId) : undefined;
        if (!session) throw new Error(`会话 "${sessionId}" 不存在`);
        await AgentRunner.run(query, callbacks, session.agent, session.saver, `session_${sessionId}`, undefined, session.memory);
    }

    private emit(event: WebChatEvent) {
        if (!this.activeWs) return;
        if (this.activeWs.readyState === WebSocket.OPEN) {
            this.activeWs.send(JSON.stringify(event));
        }
    }
}
