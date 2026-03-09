import "reflect-metadata";
import { AgentMessage, AgentToolCall, MCPToolResult } from "scorpio.ai";
import { WebSocket } from "ws";
import { AgentRunner } from "../Agent/AgentRunner";

export type WebChatEvent =
    | { type: "stream"; content: string }
    | { type: "message"; role: string; content?: string; tool_calls?: any[] }
    | { type: "tool_call"; name: string; args: Record<string, any> }
    | { type: "done" }
    | { type: "error"; message: string };

export class WebSocketUserService {
    private clients = new Set<WebSocket>();

    registerWs(ws: WebSocket): void {
        this.clients.add(ws);
    }

    unregisterWs(ws: WebSocket): void {
        this.clients.delete(ws);
    }

    // ===== Called by UserService =====

    async startProcessMessage(_query: string, _args: any): Promise<string> {
        return '';
    }

    async onMessageProcessed(): Promise<void> {
        this.emit({ type: 'done' });
    }

    async processMessageError(e: any): Promise<void> {
        this.emit({ type: 'error', message: e.message });
    }

    async onAgentMessage(message: AgentMessage): Promise<void> {
        this.emit({
            type: 'message',
            role: message.type,
            content: message.content,
            tool_calls: message.tool_calls,
        });
    }

    async onAgentStreamMessage(message: AgentMessage): Promise<void> {
        this.emit({ type: 'stream', content: message.content ?? '' });
    }

    async executeAgentTool(toolCall: AgentToolCall): Promise<boolean> {
        this.emit({ type: 'tool_call', name: toolCall.name, args: toolCall.args });
        return true;
    }

    async askUser(_question: string): Promise<string> {
        return '';
    }

    async processAIMessage(query: string, args: any): Promise<void> {
        const { config } = await import('../Core/Config');
        const session = config.getSession(args?.sessionId);
        await AgentRunner.run(query, {
            onMessage: this.onAgentMessage.bind(this),
            onStreamMessage: this.onAgentStreamMessage.bind(this),
            executeTool: this.executeAgentTool.bind(this),
            convertImages: async (r: MCPToolResult) => r,
        }, undefined, session?.agent, session?.saver, session?.memory);
    }

    private emit(event: WebChatEvent) {
        const msg = JSON.stringify(event);
        for (const ws of this.clients) {
            if (ws.readyState === WebSocket.OPEN) ws.send(msg);
        }
    }
}
