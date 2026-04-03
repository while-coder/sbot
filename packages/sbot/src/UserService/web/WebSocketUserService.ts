import "reflect-metadata";
import { ChatMessage, AskToolParams, MessageRole, MessageType } from "scorpio.ai";
import { AgentRunner, AgentSchedulerContext, createAskAgentTool } from "../../Agent/AgentRunner";
import { config } from '../../Core/Config';
import { SchedulerType } from '../../Core/Database';
import { buildExecuteTool } from '../buildExecuteTool';
import { SessionService, type ChannelMessageArgs } from 'channel.base';
import { WebChatEvent, WebChatEventType } from 'sbot.commons';
import { httpServer } from "../../Server/HttpServer";

const WEB_ASK_PROMPT = 'Ask the user one or more structured questions and wait for their response. Use this tool whenever you need clarification, a decision, or input before proceeding.\n\nQuestion types:\n- radio: single-choice selection from a fixed list (optionally with a custom "Other" option)\n- checkbox: multi-choice selection from a fixed list (optionally with a custom "Other" option)\n- input: free-text entry with an optional placeholder\n- toggle: boolean on/off switch\n\nReturns a map of question label → answer (string for radio/input, string[] for checkbox, boolean for toggle).';

export { WebChatEvent, WebChatEventType } from 'sbot.commons';

export class WebSocketUserService {
    protected readonly session: SessionService;

    constructor(session: SessionService) {
        this.session = session;
    }

    // ── Message lifecycle ──

    async onProcessStart(_query: string, args: ChannelMessageArgs, _messageType: MessageType): Promise<void> {
        this.emit({ type: WebChatEventType.Queue, pendingMessages: (args as any)?.pendingMessages ?? [] }, args.sessionId);
    }

    async onProcessEnd(_query: string, args: ChannelMessageArgs, _messageType: MessageType, error?: any): Promise<void> {
        if (error) {
            this.emit({ type: WebChatEventType.Error, message: error.message }, args.sessionId);
        }
        this.emit({ type: WebChatEventType.Done, pendingMessages: (args as any)?.pendingMessages ?? [] }, args.sessionId);
    }

    async onCommandResult(content: string, args: any): Promise<void> {
        this.emitChatMessage({ role: MessageRole.AI, content, isCommand: true }, args?.sessionId);
    }

    async onChatMessage(message: ChatMessage): Promise<void> {
        this.emitChatMessage(message);
    }

    async onStreamMessage(message: ChatMessage): Promise<void> {
        this.emit({ type: WebChatEventType.Stream, content: message.content ?? '' });
    }

    // ── Core AI processing ──

    async processAI(query: string, args: any): Promise<void> {
        const sessionId = args?.sessionId as string;
        this.emit({ type: WebChatEventType.Human, content: query }, sessionId);

        const sessionCfg = sessionId ? config.getSession(sessionId) : undefined;
        if (!sessionCfg) throw new Error(`Session "${sessionId}" not found`);

        const { agent: agentId, saver: saverId, memories, workPath } = sessionCfg;
        const scheduler: AgentSchedulerContext = { schedulerType: SchedulerType.Session, schedulerId: sessionId };

        const threadId = this.session.threadId;
        await AgentRunner.run({
            query,
            callbacks: {
                onMessage: async (msg) => this.emitChatMessage(msg, sessionId),
                onStreamMessage: async (msg) => this.emit({ type: WebChatEventType.Stream, content: msg.content ?? '' }, sessionId),
                executeTool: buildExecuteTool(this.session, agentId, (tc) => {
                    const { id, promise } = this.session.enterApproval(tc, 0);
                    this.emit({ type: WebChatEventType.ToolCall, id, name: tc.name, args: tc.args }, sessionId);
                    return promise;
                }),
            },
            agentId, saverId, threadId, scheduler, extraInfo: '', memories,
            workPath,
            agentTools: [createAskAgentTool(WEB_ASK_PROMPT, async (params: AskToolParams) => {
                const { id: askId, promise } = this.session.enterAsk(params, 0);
                this.emit({ type: WebChatEventType.Ask, id: askId, title: params.title, questions: params.questions as any }, sessionId);
                return promise;
            })],
        });
    }

    // ── Emit ──

    private emitChatMessage(message: ChatMessage, sessionId?: string): void {
        const evt: any = {
            type: WebChatEventType.Message,
            role: message.isCommand ? 'command' : message.role,
            content: message.content,
            tool_calls: message.tool_calls,
            tool_call_id: message.tool_call_id,
        };
        const thinkId = message.additional_kwargs?.thinkId as string | undefined;
        if (thinkId) evt.thinkId = thinkId;
        this.emit(evt, sessionId);
    }

    private emit(event: WebChatEvent, sessionId?: string): void {
        const payload = { ...event, sessionId };
        httpServer.broadcastToWs(JSON.stringify(payload));
    }
}
