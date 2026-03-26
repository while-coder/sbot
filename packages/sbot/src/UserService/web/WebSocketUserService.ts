import "reflect-metadata";
import { MessageType } from "scorpio.ai";
import { WebChatEventType } from 'sbot.commons';
import { BaseWebUserService, WebChatEvent } from "./BaseWebUserService";
import { httpServer } from "../../Server/HttpServer";

export class WebSocketUserService extends BaseWebUserService {
    private activeSessionId: string | undefined;
    private activeWorkPath: string | undefined;

    private clearContext(): void {
        this.activeSessionId = undefined;
        this.activeWorkPath = undefined;
    }

    // ===== Called by UserService =====

    async startProcessMessage(_query: string, _args: any, _messageType: MessageType): Promise<string> {
        return '';
    }

    async onMessageProcessed(_args: any, _messageType: MessageType): Promise<void> {
        this.emit({ type: WebChatEventType.Done });
        this.clearContext();
    }

    async processMessageError(e: any, _args: any, _messageType: MessageType): Promise<void> {
        this.emit({ type: WebChatEventType.Error, message: e.message });
        this.clearContext();
    }

    async processAIMessage(query: string, args: any): Promise<void> {
        this.activeWorkPath = args?.workPath;
        this.activeSessionId = args?.sessionId;
        await super.processAIMessage(query, args);
    }

    protected emit(event: WebChatEvent): void {
        const ctx: any = {};
        if (this.activeSessionId) ctx.sessionId = this.activeSessionId;
        if (this.activeWorkPath)  ctx.workPath  = this.activeWorkPath;
        httpServer.broadcastToWs(JSON.stringify({ ...event, ...ctx }));
    }
}
