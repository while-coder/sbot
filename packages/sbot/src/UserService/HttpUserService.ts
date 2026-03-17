import "reflect-metadata";
import { Response } from "express";
import { BaseWebUserService, WebChatEvent } from "./BaseWebUserService";

export class HttpUserService extends BaseWebUserService {
    private activeRes: Response | null = null;

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

    // ===== Called by UserService =====

    async startProcessMessage(_query: string, args: any): Promise<string> {
        if (args?.res) this.setResponse(args.res);
        return '';
    }

    async onMessageProcessed(): Promise<void> {
        this.emit({ type: 'done' });
    }

    async processMessageError(e: any): Promise<void> {
        this.emit({ type: 'error', message: e.message });
    }

    protected emit(event: WebChatEvent): void {
        if (!this.activeRes) return;
        this.activeRes.write(`data: ${JSON.stringify(event)}\n\n`);
    }
}
