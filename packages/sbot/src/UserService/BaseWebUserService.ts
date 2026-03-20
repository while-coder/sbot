import "reflect-metadata";
import { AgentMessage, AgentToolCall, AskResponse, AskToolParams, MessageChunkType, MessageType, ToolApproval } from "scorpio.ai";
import { AgentRunner } from "../Agent/AgentRunner";
import { config } from '../Core/Config';
import { ContextType } from '../Core/Database';
import { buildExecuteTool } from './buildExecuteTool';
import { sessionManager } from '../Agent/SessionManager';
import { dirThreadId, sessionThreadId, WebChatEvent, WebChatEventType } from 'sbot.commons';

export { WebChatEvent, WebChatEventType } from 'sbot.commons';

export abstract class BaseWebUserService {
    private activeThreadIds: Set<string> = new Set();

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
            sessionManager.denyAllApprovals(threadId);
            sessionManager.rejectAsk(threadId, 'Connection closed');
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

    protected getToolCallTimeout(): number {
        return 300_000;
    }

    protected getAskTimeout(): number {
        return 600_000;
    }

    async executeAgentTool(threadId: string, toolCall: AgentToolCall): Promise<ToolApproval> {
        const id = toolCall.id ?? `tc-${Date.now()}`;
        this.emit({ type: WebChatEventType.ToolCall, id, name: toolCall.name, args: toolCall.args });
        return new Promise<ToolApproval>((resolve) => {
            const timer = setTimeout(() => {
                sessionManager.resolveToolApproval(id, ToolApproval.Deny);
            }, this.getToolCallTimeout());
            sessionManager.registerToolApproval(threadId, id, (approval) => {
                clearTimeout(timer);
                resolve(approval);
            });
        });
    }

    resolveToolApproval(id: string, approval: ToolApproval): void {
        sessionManager.resolveToolApproval(id, approval);
    }

    resolveAsk(threadId: string, answers: AskResponse): boolean {
        return sessionManager.resolveAsk(threadId, answers);
    }

    cancel(threadId: string): boolean {
        return sessionManager.cancel(threadId);
    }

    async processAIMessage(query: string, args: any): Promise<void> {
        this.emit({ type: WebChatEventType.Human, content: query });

        const workPath = args?.workPath as string | undefined;
        let threadId: string, agentId: string, saverId: string, memoryId: string | undefined;
        let contextType: ContextType, extraInfo: string;

        if (workPath) {
            const cfg = config.getDirectoryConfig(workPath);
            if (!cfg) throw new Error(`Directory "${workPath}" has no agent configured`);
            threadId = dirThreadId(workPath);
            ({ agent: agentId, saver: saverId, memory: memoryId } = cfg);
            contextType = ContextType.Directory;
            extraInfo = `<scheduler-id>${workPath}</scheduler-id>`;
        } else {
            const sessionId = args?.sessionId as string;
            const session = sessionId ? config.getSession(sessionId) : undefined;
            if (!session) throw new Error(`Session "${sessionId}" not found`);
            threadId = sessionThreadId(sessionId);
            ({ agent: agentId, saver: saverId, memory: memoryId } = session);
            contextType = ContextType.Session;
            extraInfo = `<scheduler-id>${sessionId}</scheduler-id>`;
        }

        this.activeThreadIds.add(threadId);
        try {
            await AgentRunner.run({
                query,
                callbacks: {
                    onMessage: this.onAgentMessage.bind(this),
                    onStreamMessage: this.onAgentStreamMessage.bind(this),
                    executeTool: buildExecuteTool(threadId, (tc) => this.executeAgentTool(threadId, tc)),
                },
                agentId, saverId, threadId, contextType, extraInfo, memoryId,
                workPath,
                askFn: async (params: AskToolParams) => {
                    const { promise } = sessionManager.openAsk(threadId, params, this.getAskTimeout());
                    this.emit({ type: WebChatEventType.Ask, id: threadId, title: params.title, questions: params.questions as any });
                    return promise;
                },
            });
        } finally {
            this.activeThreadIds.delete(threadId);
        }
    }
}
