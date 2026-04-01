import "reflect-metadata";
import { AgentMessage, AskToolParams, MessageRole, MessageType } from "scorpio.ai";
import { AgentRunner, AgentSchedulerContext, createAskAgentTool } from "../../Agent/AgentRunner";
import { config } from '../../Core/Config';
import { SchedulerType } from '../../Core/Database';
import { buildExecuteTool } from '../buildExecuteTool';
import { SessionService } from 'channel.base';
import { WebChatEvent, WebChatEventType, ChannelType } from 'sbot.commons';
import { httpServer } from "../../Server/HttpServer";

export { WebChatEvent, WebChatEventType } from 'sbot.commons';

export class WebSocketUserService {
    protected readonly session: SessionService;

    constructor(session: SessionService) {
        this.session = session;
    }

    // ── Message lifecycle ──

    async onProcessStart(_query: string, args: any, _messageType: MessageType): Promise<void> {
        this.emit({ type: WebChatEventType.Queue, pendingMessages: args?.pendingMessages ?? [] });
    }

    async onProcessEnd(_query: string, args: any, _messageType: MessageType, error?: any): Promise<void> {
        if (error) {
            this.emit({ type: WebChatEventType.Error, message: error.message });
        }
        this.emit({ type: WebChatEventType.Done, pendingMessages: args?.pendingMessages ?? [] });
    }

    async onCommandResult(content: string, _args: any): Promise<void> {
        return this.onAgentMessage({ role: MessageRole.AI, content, isCommand: true });
    }

    async onAgentMessage(message: AgentMessage): Promise<void> {
        this.emit({
            type: WebChatEventType.Message,
            role: message.isCommand ? 'command' : message.role,
            content: message.content as string | undefined,
            tool_calls: message.tool_calls,
            tool_call_id: message.tool_call_id,
        });
    }

    async onAgentStreamMessage(message: AgentMessage): Promise<void> {
        this.emit({ type: WebChatEventType.Stream, content: message.content as string ?? '' });
    }

    // ── Core AI processing ──

    async processAI(query: string, args: any): Promise<void> {
        this.emit({ type: WebChatEventType.Human, content: query });

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
            const sessionCfg = sessionId ? config.getSession(sessionId) : undefined;
            if (!sessionCfg) throw new Error(`Session "${sessionId}" not found`);
            agentId = sessionCfg.agent; saverId = sessionCfg.saver; memories = sessionCfg.memories;
            scheduler = { schedulerType: SchedulerType.Session, schedulerId: sessionId };
            extraInfo = '';
        }

        const threadId = this.session.threadId;
        await AgentRunner.run({
            query,
            callbacks: {
                onMessage: (msg) => this.onAgentMessage(msg),
                onStreamMessage: (msg) => this.onAgentStreamMessage(msg),
                executeTool: buildExecuteTool(this.session, agentId, (tc) => {
                    const { id, promise } = this.session.enterApproval(tc, 300_000);
                    this.emit({ type: WebChatEventType.ToolCall, id, threadId, name: tc.name, args: tc.args });
                    return promise;
                }),
            },
            agentId, saverId, threadId, scheduler, extraInfo, memories,
            workPath,
            agentTools: [createAskAgentTool(ChannelType.Web, async (params: AskToolParams) => {
                const { id: askId, promise } = this.session.enterAsk(params, 600_000);
                this.emit({ type: WebChatEventType.Ask, id: askId, threadId, title: params.title, questions: params.questions as any });
                return promise;
            })],
        });
    }

    // ── Emit ──

    private emit(event: WebChatEvent): void {
        const payload = { ...event, threadId: this.session.threadId };
        httpServer.broadcastToWs(JSON.stringify(payload));
    }
}
