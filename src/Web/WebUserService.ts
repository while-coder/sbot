import "reflect-metadata";
import { UserServiceBase } from "winning.ai";
import {
    AgentMessage,
    AgentToolCall,
    MCPToolResult,
    ICommand,
} from "scorpio.ai";
import { Response } from "express";
import { getBuiltInCommands } from "../UserService/BuiltInCommands";
import { AgentRunner } from "../AgentRunner";

export type WebChatEvent =
    | { type: "stream"; content: string }
    | { type: "message"; role: string; content?: string; tool_calls?: any[] }
    | { type: "tool_call"; name: string; args: Record<string, any> }
    | { type: "done" }
    | { type: "error"; message: string };

type EmitFn = (event: WebChatEvent) => void;

export class WebUserService extends UserServiceBase {
    static allUsers = new Map<string, WebUserService>();

    static getUser(userId: string): WebUserService {
        if (WebUserService.allUsers.has(userId)) {
            return WebUserService.allUsers.get(userId)!;
        }
        const user = new WebUserService(userId);
        WebUserService.allUsers.set(userId, user);
        return user;
    }

    private currentEmit?: EmitFn;

    private emit(event: WebChatEvent) {
        this.currentEmit?.(event);
    }

    /**
     * 处理 Web 消息，消息按顺序执行，支持 / 开头的命令。
     * - await：等待处理完成（SSE 场景）
     * - 不 await：fire-and-forget
     */
    async onReceiveWebMessage(query: string, emitFn: EmitFn): Promise<void> {
        return new Promise<void>((resolve) => {
            this.onReceiveMessage(query, { emitFn }, resolve);
        });
    }

    // ===== UserServiceBase 抽象方法实现 =====

    protected async getAllCommands(): Promise<ICommand[]> {
        return getBuiltInCommands();
    }

    protected async startProcessMessage(_query: string, args: any): Promise<string> {
        this.currentEmit = (args as { emitFn: EmitFn }).emitFn;
        return '';
    }

    protected async onMessageProcessed(_query: string, _args: any): Promise<void> {
        this.emit({ type: "done" });
        this.currentEmit = undefined;
    }

    protected async processMessageError(e: any): Promise<void> {
        this.emit({ type: "error", message: e.message });
    }

    protected async onAgentMessage(message: AgentMessage): Promise<void> {
        this.emit({
            type: "message",
            role: message.type,
            content: message.content,
            tool_calls: message.tool_calls,
        });
    }

    protected async onAgentStreamMessage(message: AgentMessage): Promise<void> {
        this.emit({ type: "stream", content: message.content ?? "" });
    }

    protected async executeAgentTool(toolCall: AgentToolCall): Promise<boolean> {
        this.emit({ type: "tool_call", name: toolCall.name, args: toolCall.args });
        return true; // Web 模式自动批准所有工具
    }

    // ===== AI 消息处理 =====

    protected async processAIMessage(query: string, _args: any): Promise<void> {
        await AgentRunner.run(this.userId, query, {
            onMessage: this.onAgentMessage.bind(this),
            onStreamMessage: this.onAgentStreamMessage.bind(this),
            executeTool: this.executeAgentTool.bind(this),
            convertImages: async (result: MCPToolResult) => result,
        });
    }

    // ===== SSE 辅助 =====

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
