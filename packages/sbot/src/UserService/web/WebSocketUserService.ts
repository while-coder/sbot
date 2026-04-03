import "reflect-metadata";
import { ChatMessage, AskToolParams, MessageType } from "scorpio.ai";
import {
    ChannelSessionHandler, ToolCallStatus, SessionService, ChannelToolHelpers, AskQuestionType,
    type ChannelMessageArgs, type ChatToolCall,
} from "channel.base";
import { WebChatEvent, WebChatEventType, WsCommandType } from 'sbot.commons';
import { httpServer } from "../../Server/HttpServer";

const WEB_ASK_PROMPT = 'Ask the user one or more structured questions and wait for their response. Use this tool whenever you need clarification, a decision, or input before proceeding.\n\nQuestion types:\n- radio: single-choice selection from a fixed list (optionally with a custom "Other" option)\n- checkbox: multi-choice selection from a fixed list (optionally with a custom "Other" option)\n- input: free-text entry with an optional placeholder\n- toggle: boolean on/off switch\n\nReturns a map of question label → answer (string for radio/input, string[] for checkbox, boolean for toggle).';

export { WebChatEvent, WebChatEventType } from 'sbot.commons';

export class WebSocketUserService extends ChannelSessionHandler {

    constructor(session: SessionService) {
        super(session);
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

    async onChatMessage(message: ChatMessage, args: ChannelMessageArgs): Promise<void> {
        this.emitChatMessage(message, args.sessionId);
    }

    async onStreamMessage(message: ChatMessage, args: ChannelMessageArgs): Promise<void> {
        this.emit({ type: WebChatEventType.Stream, content: message.content ?? '' }, args.sessionId);
    }

    // ── Approval / Ask ──

    /** Derive the original sessionId from the threadId ("session_xxx" → "xxx"). */
    private get sessionId(): string | undefined {
        const tid = this.session.threadId;
        return tid.startsWith('session_') ? tid.slice('session_'.length) : undefined;
    }

    protected async enterApproval(approvalId: string, _remainSec: number, toolCall: ChatToolCall): Promise<void> {
        this.emit({ type: WebChatEventType.ToolCall, id: approvalId, name: toolCall.name, args: toolCall.args }, this.sessionId);
    }

    protected async exitApproval(_approvalId: string): Promise<void> {
        // WebSocket clients manage their own UI — no cleanup needed
    }

    protected async enterAsk(askId: string, _remainSec: number, params: AskToolParams): Promise<void> {
        this.emit({ type: WebChatEventType.Ask, id: askId, title: params.title, questions: params.questions as any }, this.sessionId);
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
