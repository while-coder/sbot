import "reflect-metadata";
import { AgentMessage, AskResponse, AskToolParams, MessageChunkType, MessageType, ToolApproval } from "scorpio.ai";
import { AgentRunner, AgentSchedulerContext, createAskAgentTool } from "../../Agent/AgentRunner";
import { config } from '../../Core/Config';
import { SchedulerType } from '../../Core/Database';
import { buildExecuteTool } from '../buildExecuteTool';
import { SessionManager } from 'channel.base';
import { WebChatEvent, WebChatEventType, ChannelType } from 'sbot.commons';
import { httpServer } from "../../Server/HttpServer";

export { WebChatEvent, WebChatEventType } from 'sbot.commons';

export class WebSocketUserService {
    protected readonly sessionManager: SessionManager;

    constructor(sessionManager: SessionManager) {
        this.sessionManager = sessionManager;
    }

    // ── Message lifecycle ──

    async onProcessStart(_threadId: string, _query: string, _args: any, _messageType: MessageType): Promise<void> {}

    async onProcessEnd(threadId: string, _query: string, _args: any, _messageType: MessageType, error?: any): Promise<void> {
        if (error) {
            this.emit({ type: WebChatEventType.Error, message: error.message }, threadId);
        }
        this.emit({ type: WebChatEventType.Done }, threadId);
    }

    async onCommandResult(threadId: string, content: string, _args: any): Promise<void> {
        return this.onAgentMessage({ type: MessageChunkType.COMMAND, content }, threadId);
    }

    async onAgentMessage(message: AgentMessage, threadId?: string): Promise<void> {
        this.emit({
            type: WebChatEventType.Message,
            role: message.type,
            content: message.content,
            tool_calls: message.tool_calls,
            tool_call_id: message.tool_call_id,
        }, threadId);
    }

    async onAgentStreamMessage(message: AgentMessage, threadId?: string): Promise<void> {
        this.emit({ type: WebChatEventType.Stream, content: message.content ?? '' }, threadId);
    }

    // ── Approval / Ask ──

    resolveToolApproval(threadId: string, id: string, approval: ToolApproval): boolean {
        return this.sessionManager.exitApproval(threadId, id, approval);
    }

    resolveAsk(threadId: string, id: string, answers: AskResponse): boolean {
        return this.sessionManager.exitAsk(threadId, id, answers);
    }

    cancel(threadId: string): boolean {
        return this.sessionManager.abort(threadId);
    }

    // ── Core AI processing ──

    async processAI(threadId: string, query: string, args: any): Promise<void> {
        this.emit({ type: WebChatEventType.Human, content: query }, threadId);

        const workPath = args?.workPath as string | undefined;
        let agentId: string, saverId: string, memories: string[] | undefined;
        let scheduler: AgentSchedulerContext, extraInfo: string;

        if (workPath) {
            const cfg = config.getDirectoryConfig(workPath);
            if (!cfg) throw new Error(`Directory "${workPath}" has no agent configured`);
            agentId = cfg.agent; saverId = cfg.saver; memories = cfg.memories;
            scheduler = { schedulerType: SchedulerType.Directory, schedulerId: workPath };
            extraInfo = '';
        } else {
            const sessionId = args?.sessionId as string;
            const session = sessionId ? config.getSession(sessionId) : undefined;
            if (!session) throw new Error(`Session "${sessionId}" not found`);
            agentId = session.agent; saverId = session.saver; memories = session.memories;
            scheduler = { schedulerType: SchedulerType.Session, schedulerId: sessionId };
            extraInfo = '';
        }

        await AgentRunner.run({
            query,
            callbacks: {
                onMessage: (msg) => this.onAgentMessage(msg, threadId),
                onStreamMessage: (msg) => this.onAgentStreamMessage(msg, threadId),
                executeTool: buildExecuteTool(threadId, (tc) => {
                    const { id, promise } = this.sessionManager.enterApproval(threadId, tc, 300_000);
                    this.emit({ type: WebChatEventType.ToolCall, id, threadId, name: tc.name, args: tc.args }, threadId);
                    return promise;
                }),
            },
            agentId, saverId, threadId, scheduler, extraInfo, memories,
            workPath,
            agentTools: [createAskAgentTool(ChannelType.Web, async (params: AskToolParams) => {
                const { id: askId, promise } = this.sessionManager.enterAsk(threadId, params, 600_000);
                this.emit({ type: WebChatEventType.Ask, id: askId, threadId, title: params.title, questions: params.questions as any }, threadId);
                return promise;
            })],
        });
    }

    // ── Emit ──

    private emit(event: WebChatEvent, threadId?: string): void {
        const payload = threadId ? { ...event, threadId } : event;
        httpServer.broadcastToWs(JSON.stringify(payload));
    }
}
