import "reflect-metadata";
import { AgentMessage, AskResponse, AskToolParams, MessageChunkType, MessageType, ToolApproval } from "scorpio.ai";
import { AgentRunner, AgentSchedulerContext, createAskAgentTool } from "../../Agent/AgentRunner";
import { config } from '../../Core/Config';
import { SchedulerType } from '../../Core/Database';
import { buildExecuteTool } from '../buildExecuteTool';
import { SessionManager } from 'channel.base';
import { dirThreadId, sessionThreadId, WebChatEvent, WebChatEventType, ChannelType } from 'sbot.commons';

export { WebChatEvent, WebChatEventType } from 'sbot.commons';

export abstract class BaseWebUserService {
    private activeThreadIds: Set<string> = new Set();
    protected readonly sessionManager: SessionManager;

    constructor(sessionManager: SessionManager) {
        this.sessionManager = sessionManager;
    }

    abstract startProcessMessage(query: string, args: any, messageType: MessageType): Promise<string>;
    abstract onMessageProcessed(args: any, messageType: MessageType): Promise<void>;
    abstract processMessageError(e: any, args: any, messageType: MessageType): Promise<void>;
    async onCommandOutput(content: string, _args: any): Promise<void> {
        return this.onAgentMessage({ type: MessageChunkType.COMMAND, content });
    }
    protected abstract emit(event: WebChatEvent): void;

    /** 连接断开时调用，拒绝所有挂起的审批和 ask */
    protected clearPendingApprovals(): void {
        for (const threadId of this.activeThreadIds) {
            this.sessionManager.exitAllApprovals(threadId);
            this.sessionManager.exitAllAsks(threadId, 'Connection closed');
        }
        this.activeThreadIds.clear();
    }

    async onAgentMessage(message: AgentMessage): Promise<void> {
        this.emit({
            type: WebChatEventType.Message,
            role: message.type,
            content: message.content,
            tool_calls: message.tool_calls,
            tool_call_id: message.tool_call_id,
        });
    }

    async onAgentStreamMessage(message: AgentMessage): Promise<void> {
        this.emit({ type: WebChatEventType.Stream, content: message.content ?? '' });
    }

    protected getApprovalTimeout(): number {
        return 300_000;
    }

    protected getAskTimeout(): number {
        return 600_000;
    }

    resolveToolApproval(threadId: string, id: string, approval: ToolApproval): boolean {
        return this.sessionManager.exitApproval(threadId, id, approval);
    }

    resolveAsk(threadId: string, id: string, answers: AskResponse): boolean {
        return this.sessionManager.exitAsk(threadId, id, answers);
    }

    cancel(threadId: string): boolean {
        return this.sessionManager.abort(threadId);
    }

    async processAIMessage(query: string, args: any, threadId: string): Promise<void> {
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
            const session = sessionId ? config.getSession(sessionId) : undefined;
            if (!session) throw new Error(`Session "${sessionId}" not found`);
            agentId = session.agent; saverId = session.saver; memories = session.memories;
            scheduler = { schedulerType: SchedulerType.Session, schedulerId: sessionId };
            extraInfo = '';
        }

        this.activeThreadIds.add(threadId);
        try {
            await AgentRunner.run({
                query,
                callbacks: {
                    onMessage: this.onAgentMessage.bind(this),
                    onStreamMessage: this.onAgentStreamMessage.bind(this),
                    executeTool: buildExecuteTool(threadId, (tc) => {
                        const { id, promise } = this.sessionManager.enterApproval(threadId, tc, this.getApprovalTimeout());
                        this.emit({ type: WebChatEventType.ToolCall, id, threadId, name: tc.name, args: tc.args });
                        return promise;
                    }),
                },
                agentId, saverId, threadId, scheduler, extraInfo, memories,
                workPath,
                agentTools: [createAskAgentTool(ChannelType.Web, async (params: AskToolParams) => {
                    const { id: askId, promise } = this.sessionManager.enterAsk(threadId, params, this.getAskTimeout());
                    this.emit({ type: WebChatEventType.Ask, id: askId, threadId, title: params.title, questions: params.questions as any });
                    return promise;
                })],
            });
        } finally {
            this.activeThreadIds.delete(threadId);
        }
    }
}
