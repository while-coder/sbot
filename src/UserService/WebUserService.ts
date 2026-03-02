import "reflect-metadata";
import { AgentMessage, AgentToolCall, MCPToolResult } from "scorpio.ai";
import { Response } from "express";
import { AgentRunner } from "../AgentRunner";

export type WebChatEvent =
    | { type: "stream"; content: string }
    | { type: "message"; role: string; content?: string; tool_calls?: any[] }
    | { type: "tool_call"; name: string; args: Record<string, any> }
    | { type: "done" }
    | { type: "error"; message: string };

export type WebEmitFn = (event: WebChatEvent) => void;
type EmitFn = WebEmitFn;

export class WebUserService {
    private currentEmit?: EmitFn;

    // ===== Called by UserService =====

    async startProcessMessage(_query: string, args: any): Promise<string> {
        this.currentEmit = args.emitFn;
        return '';
    }

    async onMessageProcessed(): Promise<void> {
        this.emit({ type: 'done' });
        this.currentEmit = undefined;
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

    async processAIMessage(query: string, _args: any): Promise<void> {
        await AgentRunner.run(query, {
            onMessage: this.onAgentMessage.bind(this),
            onStreamMessage: this.onAgentStreamMessage.bind(this),
            executeTool: this.executeAgentTool.bind(this),
            convertImages: async (r: MCPToolResult) => r,
        });
    }

    private emit(event: WebChatEvent) {
        this.currentEmit?.(event);
    }

    static sendSSE(res: Response, run: (emit: EmitFn) => Promise<void>): void {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.flushHeaders();
        const write: EmitFn = (event) => {
            res.write(`data: ${JSON.stringify(event)}\n\n`);
        };
        run(write).finally(() => res.end());
    }
}
