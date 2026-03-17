import "reflect-metadata";
import { WebSocket } from "ws";
import { BaseWebUserService, WebChatEvent } from "./BaseWebUserService";

// Re-export for backward compatibility
export type { WebChatEvent } from "./BaseWebUserService";

export class WebSocketUserService extends BaseWebUserService {
    private activeWs: WebSocket | null = null;
    private activeSessionId: string | undefined;
    private activeWorkPath: string | undefined;

    private setWs(ws: WebSocket): void {
        this.activeWs = ws;
        ws.on('close', () => {
            if (this.activeWs === ws) this.clearWs();
        });
    }

    private clearWs(): void {
        this.activeWs = null;
        this.clearPendingApprovals();
    }

    private clearContext(): void {
        this.activeSessionId = undefined;
        this.activeWorkPath = undefined;
    }

    // ===== Called by UserService =====

    async startProcessMessage(_query: string, args: any): Promise<string> {
        if (args?.ws) this.setWs(args.ws);
        return '';
    }

    async onMessageProcessed(): Promise<void> {
        this.emit({ type: 'done' });
        this.clearContext();
        this.clearWs();
    }

    async processMessageError(e: any): Promise<void> {
        this.emit({ type: 'error', message: e.message });
        this.clearContext();
        this.clearWs();
    }

    async processAIMessage(query: string, args: any): Promise<void> {
        if (args?.workPath) this.activeWorkPath = args.workPath;
        else                this.activeSessionId = args?.sessionId;
        await super.processAIMessage(query, args);
    }

    protected emit(event: WebChatEvent): void {
        if (!this.activeWs) return;
        if (this.activeWs.readyState === WebSocket.OPEN) {
            const ctx: any = {};
            if (this.activeSessionId) ctx.sessionId = this.activeSessionId;
            if (this.activeWorkPath)  ctx.workPath  = this.activeWorkPath;
            this.activeWs.send(JSON.stringify({ ...event, ...ctx }));
        }
    }
}
