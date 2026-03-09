import "reflect-metadata";
import { AgentMessage, AgentToolCall, MCPToolResult } from "scorpio.ai";
import { Response } from "express";
import { AgentRunner } from "../Agent/AgentRunner";
import { WebChatEvent } from "./WebSocketUserService";

export class HttpUserService {
    private activeRes: Response | null = null;

    setResponse(res: Response): void {
        this.activeRes = res;
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();
    }

    clearResponse(): void {
        this.activeRes = null;
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
        const callbacks = {
            onMessage: this.onAgentMessage.bind(this),
            onStreamMessage: this.onAgentStreamMessage.bind(this),
            executeTool: this.executeAgentTool.bind(this),
            convertImages: async (r: MCPToolResult) => r,
        };
        const agentId = args?.agentId as string;
        const saveId = args?.saveId as string;
        const memoryId = args?.memoryId as string;
        const workPath = (args?.workPath as string)?.replace(/[:/\\]/g, '_');
        await AgentRunner.run(query, callbacks, agentId, saveId, workPath, undefined, memoryId);
    }

    private emit(event: WebChatEvent) {
        if (!this.activeRes) return;
        this.activeRes.write(`data: ${JSON.stringify(event)}\n\n`);
    }
}
