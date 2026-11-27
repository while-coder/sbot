import "reflect-metadata";
import { ChatMessage, MessageType, type MessageContent, formatError } from "scorpio.ai";
import {
    ChannelSessionHandler, ToolCallStatus, SessionService,
    ToolApproval,
    type AskToolParams,
    type ChannelMessageArgs, type ChatToolCall,
} from "channel.base";
import { WebChatEventType, WsCommandType, ApprovalTimeoutValue } from '@sbot/shared';
import { webService } from "./WebService";

export { WebChatEventType } from '@sbot/shared';
export type { WebChatEvent } from '@sbot/shared';

export class WebSocketSessionHandler extends ChannelSessionHandler {

    constructor(session: SessionService) {
        super(session);
    }

    // ── Message lifecycle ──

    async onProcessStart(_query: MessageContent, args: ChannelMessageArgs, _messageType: MessageType): Promise<void> {
        this.emit(WebChatEventType.Queue, { pendingMessages: args?.pendingMessages ?? [] });
    }

    async onProcessEnd(_query: MessageContent, args: ChannelMessageArgs, _messageType: MessageType, error?: any): Promise<void> {
        if (error) {
            this.emit(WebChatEventType.Error, { message: formatError(error) });
        }
        this.emit(WebChatEventType.Done, { pendingMessages: args?.pendingMessages ?? [] });
    }

    async onChatMessage(message: ChatMessage, _args: ChannelMessageArgs): Promise<void> {
        const thinkId = message.additional_kwargs?.thinkId as string | undefined;
        const taskId = message.additional_kwargs?.taskId as string | undefined;
        this.emit(WebChatEventType.Message, { message, thinkId, taskId, createdAt: Date.now() / 1000 });
    }

    async onStreamMessage(message: ChatMessage, _args: ChannelMessageArgs): Promise<void> {
        this.emit(WebChatEventType.Stream, { content: message.content ?? '' });
    }

    // ── Approval / Ask ──

    protected async enterApproval(approvalId: string, remainSec: number, toolCall: ChatToolCall): Promise<void> {
        const timeoutValue = remainSec > 0
            ? (this.approvalTimeoutValue === ToolApproval.Allow ? ApprovalTimeoutValue.Allow : ApprovalTimeoutValue.Deny)
            : undefined;
        this.emit(WebChatEventType.ToolCall, {
            approvalId, toolCallId: toolCall.id, name: toolCall.name, args: toolCall.args,
            remainSec: remainSec > 0 ? remainSec : undefined,
            timeoutValue,
        });
    }

    protected async exitApproval(approvalId: string): Promise<void> {
        this.emit(WebChatEventType.ApprovalDone, { id: approvalId });
    }

    protected async enterAsk(askId: string, remainSec: number, params: AskToolParams): Promise<void> {
        this.emit(WebChatEventType.Ask, {
            id: askId, title: params.title, questions: params.questions as any,
            remainSec: remainSec > 0 ? remainSec : undefined,
        });
    }

    protected async exitAsk(askId: string): Promise<void> {
        this.emit(WebChatEventType.AskDone, { id: askId });
    }

    // ── Trigger actions from WebSocket client ──

    async onTriggerAction(type: string, msg: Record<string, any>): Promise<void> {
        switch (type) {
            case WsCommandType.Approval: {
                const statusMap: Record<string, ToolCallStatus> = {
                    allow: ToolCallStatus.Allow,
                    alwaysArgs: ToolCallStatus.AlwaysArgs,
                    alwaysTool: ToolCallStatus.AlwaysTool,
                    deny: ToolCallStatus.Deny,
                };
                this.resolveApproval(msg.id, statusMap[msg.approval] ?? ToolCallStatus.Deny);
                break;
            }
            case WsCommandType.Ask:
                this.resolveAsk(msg.id, msg.answers);
                break;
            case WsCommandType.Abort:
                this.abort();
                break;
        }
    }

    // ── Emit helpers ──

    private emit(type: WebChatEventType, data: Record<string, any>): void {
        webService.broadcast(JSON.stringify({ profileId: this.session.threadId, type, data }));
    }
}
