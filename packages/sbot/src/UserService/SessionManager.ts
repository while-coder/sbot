import "reflect-metadata";
import { ICommand, MessageType } from "scorpio.ai";
import { SessionManager, SessionService } from "channel.base";
import { ChannelType, WsCommandType } from "sbot.commons";
import { config } from "../Core/Config";
import { channelManager } from "../Channel/ChannelManager";
import { createProcessAIHandler } from "../Channel/createProcessAIHandler";

import { getBuiltInCommands } from "./BuiltInCommands";
import { WebSocketUserService } from "./web/WebSocketUserService";

const processAIHandler = createProcessAIHandler();

// ── Per-session concrete class ──

class SbotSession extends SessionService {
    private manager: SbotSessionManager;
    private channel?: any;

    constructor(threadId: string, manager: SbotSessionManager) {
        super(threadId, config.getConfigPath(`sessions/${threadId}/settings.json`));
        this.manager = manager;
    }

    private getChannel(args: any) {
        if (!this.channel) {
            this.channel = this.manager.createChannel(args?.channelType, this, args?.channelId);
        }
        return this.channel;
    }

    private argsWithQueue(args: any): any {
        return { ...args, pendingMessages: this.messageQueue.map(m => m.query) };
    }

    protected async onProcessStart(query: string, args: any, messageType: MessageType): Promise<void> {
        await this.getChannel(args).onProcessStart(query, this.argsWithQueue(args), messageType);
    }

    protected async processAI(query: string, args: any): Promise<void> {
        await this.getChannel(args).processAI(query, args);
    }

    protected async onCommandResult(content: string, args: any): Promise<void> {
        await this.getChannel(args).onCommandResult(content, args);
    }

    protected async onProcessEnd(query: string, args: any, messageType: MessageType, error?: any): Promise<void> {
        await this.getChannel(args).onProcessEnd(query, this.argsWithQueue(args), messageType, error);
        if (this.messageQueue.length === 0) {
            this.manager.end(this.threadId);
        }
    }

    protected async getAllCommands(): Promise<ICommand[]> {
        return getBuiltInCommands();
    }

    resolveSaverId(args: any): string | undefined {
        const channelType = args?.channelType as string | undefined;
        if (channelType === ChannelType.Web) {
            const sessionId = args?.sessionId as string | undefined;
            return sessionId ? config.getSession(sessionId)?.saver : undefined;
        }
        const channelId = args?.channelId as string | undefined;
        return channelId ? config.getChannel(channelId)?.saver : undefined;
    }

    async triggerAction(...args: any[]): Promise<void> {
        await this.channel?.onTriggerAction(...args);
    }
}

// ── Session manager singleton ──

export class SbotSessionManager extends SessionManager {

    constructor() {
        super();
    }

    protected createSession(threadId: string): SessionService {
        return new SbotSession(threadId, this);
    }

    createChannel(type: string, session: SessionService, channelId?: string): any {
        if (type === ChannelType.Web) {
            return new WebSocketUserService(session);
        }
        const service = channelId ? channelManager.getService(channelId) : undefined;
        if (!service) {
            return new WebSocketUserService(session);  // fallback
        }
        const userService = service.createUserService(session);
        userService.setProcessAIHandler(processAIHandler);
        return userService;
    }

    // ── Channel entry points ──

    async onReceiveChannelMessage(threadId: string, query: string, args: any): Promise<void> {
        if (!query?.trim()) return;
        const session = this.getOrCreate(threadId);
        await session.onReceiveMessage(query, args);
    }

    async onReceiveWebMessage(threadId: string, query: string, sessionId?: string): Promise<void> {
        if (!query?.trim()) return;
        const session = this.getOrCreate(threadId);
        await session.onReceiveMessage(query, { channelType: ChannelType.Web, sessionId });
    }

    // ── Trigger action routing ──

    async onChannelTriggerAction(threadId: string, args: any): Promise<void> {
        const session = this.getSession(threadId) as SbotSession | undefined;
        await session?.triggerAction(args);
    }

    onWebTriggerAction(threadId: string, type: string, msg: Record<string, any>): void {
        switch (type) {
            case WsCommandType.Approval: {
                const { id, approval } = msg;
                if (id && approval) this.exitApproval(threadId, id, approval);
                break;
            }
            case WsCommandType.Ask: {
                const { id, answers } = msg;
                if (id && answers) this.exitAsk(threadId, id, answers);
                break;
            }
            case WsCommandType.Abort: {
                this.abort(threadId);
                break;
            }
        }
    }
}

export const sessionManager = new SbotSessionManager();
