import "reflect-metadata";
import { Response } from "express";
import { MessageType } from "scorpio.ai";
import { WebChatEventType } from 'sbot.commons';
import { SessionManager } from 'channel.base';
import { BaseWebUserService, WebChatEvent } from "./BaseWebUserService";

export class HttpUserService extends BaseWebUserService {
    private activeRes: Response | null = null;

    constructor(sessionManager: SessionManager) {
        super(sessionManager);
    }

    private setResponse(res: Response): void {
        this.activeRes = res;
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();
        res.on('close', () => {
            if (this.activeRes === res) this.clearResponse();
        });
    }

    private clearResponse(): void {
        this.activeRes = null;
        this.clearPendingApprovals();
    }

    // ===== Called by SbotSession =====

    async startProcessMessage(_query: string, args: any, _messageType: MessageType): Promise<string> {
        if (args?.res) this.setResponse(args.res);
        return '';
    }

    async onMessageProcessed(_args: any, _messageType: MessageType): Promise<void> {
        this.emit({ type: WebChatEventType.Done });
    }

    async processMessageError(e: any, _args: any, _messageType: MessageType): Promise<void> {
        this.emit({ type: WebChatEventType.Error, message: e.message });
    }

    protected emit(event: WebChatEvent): void {
        if (!this.activeRes) return;
        this.activeRes.write(`data: ${JSON.stringify(event)}\n\n`);
    }
}
