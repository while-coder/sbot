import "reflect-metadata";
import { AgentMessage, AgentToolCall, MCPToolResult } from "scorpio.ai";
import { Response } from "express";
import { AgentRunner } from "../Agent/AgentRunner";
import { config } from '../Core/Config';
import { WebChatEvent } from "./WebSocketUserService";

export class HttpUserService {
    private activeRes: Response | null = null;

    private setResponse(res: Response): void {
        this.activeRes = res;
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();
        res.on('close', () => {
            if (this.activeRes === res) this.clearResponse();
        });
    }

    private clearResponse(): void {
        this.activeRes = null;
    }

    // ===== Called by UserService =====

    async startProcessMessage(_query: string, args: any): Promise<string> {
        if (args?.res) this.setResponse(args.res);
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
        const workPath = args?.workPath as string | undefined;
        if (workPath) {
            // 目录模式：从 workPath/.sbot/settings.json 读取 agent/saver/memory
            const localCfg = config.getDirectoryConfig(workPath);
            if (!localCfg || !localCfg.agent) throw new Error(`目录 "${workPath}" 未配置 agent`);
            const safeWp = workPath.replace(/[:/\\]/g, '_');
            await AgentRunner.run(query, callbacks, localCfg.agent, localCfg.saver ?? '', `dir_${safeWp}`, undefined, localCfg.memory, workPath, 'directory');
        } else {
            // 会话模式：通过 sessionId 查找全局会话配置
            const sessionId = args?.sessionId as string;
            const session = sessionId ? config.getSession(sessionId) : undefined;
            if (!session) throw new Error(`会话 "${sessionId}" 不存在`);
            await AgentRunner.run(query, callbacks, session.agent, session.saver, `session_${sessionId}`, undefined, session.memory, undefined, 'session');
        }
    }

    private emit(event: WebChatEvent) {
        if (!this.activeRes) return;
        this.activeRes.write(`data: ${JSON.stringify(event)}\n\n`);
    }
}
