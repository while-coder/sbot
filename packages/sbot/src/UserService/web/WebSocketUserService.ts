import "reflect-metadata";
import { ChatMessage, AskToolParams, MessageType } from "scorpio.ai";
import {
    ChannelSessionHandler, ToolCallStatus, SessionService, ChannelToolHelpers, AskQuestionType,
    type ChannelMessageArgs, type ChatToolCall,
} from "channel.base";
import { WebChatEventType, WsCommandType } from 'sbot.commons';
import { httpServer } from "../../Server/HttpServer";

const WEB_ASK_PROMPT = 'Ask the user one or more structured questions and wait for their response. Use this tool whenever you need clarification, a decision, or input before proceeding.\n\nQuestion types:\n- radio: single-choice selection from a fixed list (optionally with a custom "Other" option)\n- checkbox: multi-choice selection from a fixed list (optionally with a custom "Other" option)\n- input: free-text entry with an optional placeholder\n- toggle: boolean on/off switch\n\nReturns a map of question label → answer (string for radio/input, string[] for checkbox, boolean for toggle).';

export { WebChatEventType } from 'sbot.commons';
export type { WebChatEvent } from 'sbot.commons';

export class WebSocketUserService extends ChannelSessionHandler {

    constructor(session: SessionService) {
        super(session);
    }

    /** Derive the original sessionId from the threadId ("session_xxx" → "xxx"). */
    private get sessionId(): string {
        const tid = this.session.threadId;
        return tid.startsWith('session_') ? tid.slice('session_'.length) : tid;
    }

    // ── Message lifecycle ──

    async onProcessStart(_query: string, args: ChannelMessageArgs, _messageType: MessageType): Promise<void> {
        this.emit(WebChatEventType.Queue, { pendingMessages: (args as any)?.pendingMessages ?? [] });
    }

    async onProcessEnd(_query: string, args: ChannelMessageArgs, _messageType: MessageType, error?: any): Promise<void> {
        if (error) {
            this.emit(WebChatEventType.Error, { message: error.message });
        }
        this.emit(WebChatEventType.Done, { pendingMessages: (args as any)?.pendingMessages ?? [] });
    }

    async onChatMessage(message: ChatMessage, _args: ChannelMessageArgs): Promise<void> {
        const thinkId = message.additional_kwargs?.thinkId as string | undefined;
        this.emit(WebChatEventType.Message, { message, thinkId, createdAt: Date.now() / 1000 });
    }

    async onStreamMessage(message: ChatMessage, _args: ChannelMessageArgs): Promise<void> {
        this.emit(WebChatEventType.Stream, { content: message.content ?? '' });
    }

    // ── Approval / Ask ──

    protected async enterApproval(approvalId: string, _remainSec: number, toolCall: ChatToolCall): Promise<void> {
        this.emit(WebChatEventType.ToolCall, { approvalId, toolCallId: toolCall.id, name: toolCall.name, args: toolCall.args });
    }

    protected async exitApproval(_approvalId: string): Promise<void> {
        // WebSocket clients manage their own UI — no cleanup needed
    }

    protected async enterAsk(askId: string, _remainSec: number, params: AskToolParams): Promise<void> {
        this.emit(WebChatEventType.Ask, { id: askId, title: params.title, questions: params.questions as any });
    }

    protected async exitAsk(_askId: string): Promise<void> {
        // WebSocket clients manage their own UI — no cleanup needed
    }

    // ── Agent tools ──

    buildAgentTools(_args: ChannelMessageArgs, helpers: ChannelToolHelpers): any[] {
        return [
            helpers.createAskTool(WEB_ASK_PROMPT, (params) => this.executeAsk(params), [AskQuestionType.Radio, AskQuestionType.Checkbox, AskQuestionType.Input]),
        ];
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
        httpServer.broadcastToWs(JSON.stringify({ sessionId: this.sessionId, type, data }));
    }
}
