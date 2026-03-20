import "reflect-metadata";
import { AgentMessage, AgentToolCall, AskResponse, AskToolParams, ToolApproval } from "scorpio.ai";
import { AgentRunner } from "../Agent/AgentRunner";
import { config } from '../Core/Config';
import { ContextType } from '../Core/Database';
import { buildExecuteTool } from './buildExecuteTool';
import { askManager } from './AskManager';
import { dirThreadId, sessionThreadId, WebChatEvent, WebChatEventType } from 'sbot.commons';

export { WebChatEvent, WebChatEventType } from 'sbot.commons';

export abstract class BaseWebUserService {
    private pendingApprovals: Map<string, (approval: ToolApproval) => void> = new Map();
    protected activeThreadId?: string;

    protected abstract emit(event: WebChatEvent): void;

    /** 连接断开时调用，拒绝所有挂起的审批和 ask */
    protected clearPendingApprovals(): void {
        for (const resolve of this.pendingApprovals.values()) resolve(ToolApproval.Deny);
        this.pendingApprovals.clear();
        if (this.activeThreadId) askManager.rejectByThreadId(this.activeThreadId, 'Connection closed');
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
        return 300_000;
    }

    async executeAgentTool(toolCall: AgentToolCall): Promise<ToolApproval> {
        const id = toolCall.id ?? `tc-${Date.now()}`;
        this.emit({ type: WebChatEventType.ToolCall, id, name: toolCall.name, args: toolCall.args });
        return new Promise<ToolApproval>((resolve) => {
            const timer = setTimeout(() => {
                this.pendingApprovals.delete(id);
                resolve(ToolApproval.Deny);
            }, this.getToolCallTimeout());
            this.pendingApprovals.set(id, (approval) => {
                clearTimeout(timer);
                this.pendingApprovals.delete(id);
                resolve(approval);
            });
        });
    }

    resolveToolApproval(id: string, approval: ToolApproval): void {
        this.pendingApprovals.get(id)?.(approval);
    }

    async ask(params: AskToolParams): Promise<AskResponse> {
        const threadId = this.activeThreadId ?? `unknown_${Date.now()}`;
        const { id, promise } = askManager.open(threadId, params, this.getAskTimeout());
        this.emit({ type: WebChatEventType.Ask, id, title: params.title, questions: params.questions as any });
        return promise;
    }

    resolveAsk(id: string, answers: AskResponse): boolean {
        return askManager.resolve(id, answers);
    }

    async processAIMessage(query: string, args: any): Promise<void> {
        this.emit({ type: WebChatEventType.Human, content: query });
        const workPath = args?.workPath as string | undefined;
        if (workPath) {
            const localCfg = config.getDirectoryConfig(workPath);
            if (!localCfg) throw new Error(`Directory "${workPath}" has no agent configured`);
            const threadId = dirThreadId(workPath);
            this.activeThreadId = threadId;
            const extraInfo = `<scheduler-id>${workPath}</scheduler-id>`;
            await AgentRunner.run(query, {
                onMessage: this.onAgentMessage.bind(this),
                onStreamMessage: this.onAgentStreamMessage.bind(this),
                executeTool: buildExecuteTool(threadId, this.executeAgentTool.bind(this)),
            }, localCfg.agent, localCfg.saver, threadId, ContextType.Directory, extraInfo, localCfg.memory, workPath);
        } else {
            const sessionId = args?.sessionId as string;
            const session = sessionId ? config.getSession(sessionId) : undefined;
            if (!session) throw new Error(`Session "${sessionId}" not found`);
            const threadId = sessionThreadId(sessionId);
            this.activeThreadId = threadId;
            const extraInfo = `<scheduler-id>${sessionId}</scheduler-id>`;
            await AgentRunner.run(query, {
                onMessage: this.onAgentMessage.bind(this),
                onStreamMessage: this.onAgentStreamMessage.bind(this),
                executeTool: buildExecuteTool(threadId, this.executeAgentTool.bind(this)),
            }, session.agent, session.saver, threadId, ContextType.Session, extraInfo, session.memory);
        }
    }
}
