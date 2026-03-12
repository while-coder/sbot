import "reflect-metadata";
import { AgentMessage, AgentToolCall, MCPToolResult } from "scorpio.ai";
import { WebSocket } from "ws";
import { AgentRunner } from "../Agent/AgentRunner";
import { config } from '../Core/Config';
import { ContextType } from '../Core/Database';

export type WebChatEvent =
    | { type: "stream"; content: string }
    | { type: "message"; role: string; content?: string; tool_calls?: any[]; tool_call_id?: string }
    | { type: "tool_call"; id?: string; name: string; args: Record<string, any> }
    | { type: "done" }
    | { type: "error"; message: string };

export class WebSocketUserService {
    private activeWs: WebSocket | null = null;
    // 用于标识当前请求归属，回传给前端以便过滤
    private activeSessionId: string | undefined;
    private activeWorkPath: string | undefined;

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

    private clearContext(): void {
        this.activeSessionId = undefined;
        this.activeWorkPath = undefined;
    }

    // ===== Called by UserService =====

    async startProcessMessage(_query: string, args: any): Promise<string> {
        if (args?.ws) this.setWs(args.ws);
        return '';
    }

    async onMessageProcessed(): Promise<void> {
        this.emit({ type: 'done' });
        this.clearContext();
        this.clearWs();
    }

    async processMessageError(e: any): Promise<void> {
        this.emit({ type: 'error', message: e.message });
        this.clearContext();
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
        if (args?.workPath) {
            // 目录模式：从 workPath/.sbot/settings.json 读取 agent/saver/memory
            this.activeWorkPath = args.workPath;
            const localCfg = config.getDirectoryConfig(args.workPath);
            if (!localCfg || !localCfg.agent) throw new Error(`目录 "${args.workPath}"  未配置 agent`);
            const workPath = args.workPath?.replace(/[:/\\]/g, '_');
            await AgentRunner.run(query, callbacks, localCfg.agent, localCfg.saver ?? '', `dir_${workPath}`, ContextType.Directory, localCfg.memory, undefined, args.workPath);
        } else {
            // 会话模式：通过 sessionId 查找全局会话配置
            const sessionId = args?.sessionId as string;
            this.activeSessionId = sessionId;
            const session = sessionId ? config.getSession(sessionId) : undefined;
            if (!session) throw new Error(`会话 "${sessionId}" 不存在`);
            await AgentRunner.run(query, callbacks, session.agent, session.saver, `session_${sessionId}`, ContextType.Session, session.memory);
        }
    }

    private emit(event: WebChatEvent) {
        if (!this.activeWs) return;
        if (this.activeWs.readyState === WebSocket.OPEN) {
            const ctx: any = {};
            if (this.activeSessionId) ctx.sessionId = this.activeSessionId;
            if (this.activeWorkPath)  ctx.workPath  = this.activeWorkPath;
            this.activeWs.send(JSON.stringify({ ...event, ...ctx }));
        }
    }
}
