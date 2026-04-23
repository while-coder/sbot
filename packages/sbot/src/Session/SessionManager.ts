import "reflect-metadata";
import { ICommand, MessageType, type MessageContent, isEmptyContent } from "scorpio.ai";
import { SessionManager, SessionService, ChannelMessageArgs, ChannelSessionHandler } from "channel.base";
import { config } from "../Core/Config";
import { database, ChannelSessionRow, SessionRow } from "../Core/Database";
import { channelManager } from "../Channel/ChannelManager";
import { createProcessAIHandler, createWebProcessAIHandler } from "../Processing/createProcessAIHandler";
import { classifyIntent } from "../Processing/classifyIntent";

import { getBuiltInCommands } from "./BuiltInCommands";
import { WebSocketSessionHandler } from "../Channel/web/WebSocketSessionHandler";

const WEB_CHANNEL = "web" as const;

interface ChannelRouteArgs extends ChannelMessageArgs {
    channelType: string;
    channelId: string;
    dbSessionId: number;
    mentionBot?: boolean;
}

interface WebRouteArgs {
    channelType: typeof WEB_CHANNEL;
    sessionId?: string;
}

type SessionRouteArgs = ChannelRouteArgs | WebRouteArgs;

const processAIHandler = createProcessAIHandler();
const webProcessAIHandler = createWebProcessAIHandler();

// ── Per-session concrete class ──

class SbotSession extends SessionService {
    private manager: SbotSessionManager;
    private channel?: any;

    constructor(threadId: string, manager: SbotSessionManager) {
        super(threadId, config.getConfigPath(`sessions/${threadId}/settings.json`));
        this.manager = manager;
    }

    private getChannel(args: SessionRouteArgs) {
        if (!this.channel) {
            const channelId = 'channelId' in args ? args.channelId : undefined;
            this.channel = this.manager.createChannel(args.channelType, this, channelId);
        }
        return this.channel;
    }

    private argsWithQueue(args: SessionRouteArgs) {
        return { ...args, pendingMessages: this.messageQueue.map(m => m.query) };
    }

    protected async onProcessStart(query: MessageContent, args: SessionRouteArgs, messageType: MessageType): Promise<string | void> {
        await this.getChannel(args).onProcessStart(query, this.argsWithQueue(args), messageType);
        const channelId = 'channelId' in args ? args.channelId : undefined;
        const channelName = channelId ? config.getChannel(channelId)?.name : undefined;
        return [args.channelType, channelName ?? channelId].filter(Boolean).join('/') || undefined;
    }

    protected async processAI(query: MessageContent, args: SessionRouteArgs): Promise<void> {
        await this.getChannel(args).processAI(query, args);
    }

    protected async onCommandResult(content: string, args: SessionRouteArgs): Promise<void> {
        await this.getChannel(args).onCommandResult(content, args);
    }

    protected async onProcessEnd(query: MessageContent, args: SessionRouteArgs, messageType: MessageType, error?: any): Promise<void> {
        await this.getChannel(args).onProcessEnd(query, this.argsWithQueue(args), messageType, error);
        if (this.messageQueue.length === 0) {
            this.manager.end(this.threadId);
        }
    }

    protected async getAllCommands(): Promise<ICommand[]> {
        return getBuiltInCommands();
    }

    async resolveSaverId(args: SessionRouteArgs): Promise<string | undefined> {
        if (args.channelType === WEB_CHANNEL) {
            const sessionId = args.sessionId;
            if (!sessionId) return undefined;
            const row = await database.findByPk<SessionRow>(database.session, sessionId);
            return row?.saver;
        }
        const channelId = 'channelId' in args ? args.channelId : undefined;
        const dbSessionId = 'dbSessionId' in args ? args.dbSessionId : undefined;
        if (dbSessionId) {
            const dbSession = await database.findByPk<ChannelSessionRow>(database.channelSession, dbSessionId);
            if (dbSession?.saver) return dbSession.saver;
        }
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

    createChannel(type: string, session: SessionService, channelId?: string): ChannelSessionHandler {
        if (type === WEB_CHANNEL) {
            const sessionHandler = new WebSocketSessionHandler(session);
            sessionHandler.setProcessAIHandler(webProcessAIHandler);
            return sessionHandler;
        } else {
            const service = channelId ? channelManager.getService(channelId) : undefined;
            if (!service) {
                throw new Error(`Channel service "${channelId}" not found`);
            }
            const sessionHandler = service.createSessionHandler(session);
            sessionHandler.setProcessAIHandler(processAIHandler);
            return sessionHandler;
        }
    }

    // ── Channel entry points ──

    async onReceiveChannelMessage(threadId: string, query: MessageContent, args: ChannelRouteArgs): Promise<void> {
        if (isEmptyContent(query)) return;

        // 意图过滤：在进入消息队列之前检查，避免触发 onProcessStart（回复卡片）
        if (!args?.mentionBot) {
            const dbSessionId = args?.dbSessionId as number | undefined;
            if (dbSessionId) {
                const dbSession = await database.findByPk<ChannelSessionRow>(database.channelSession, dbSessionId);
                const channel = args.channelId ? config.getChannel(args.channelId) : undefined;
                const intentModel = dbSession?.intentModel != null ? dbSession.intentModel : channel?.intentModel;
                if (intentModel) {
                    const intentPrompt = dbSession?.intentPrompt != null ? dbSession.intentPrompt : (channel?.intentPrompt ?? null);
                    const intentThreshold = dbSession?.intentThreshold != null ? dbSession.intentThreshold : (channel?.intentThreshold ?? 0.7);
                    const shouldReply = await classifyIntent(query, intentModel, intentPrompt, intentThreshold);
                    if (!shouldReply) return;
                }
            }
        }

        const session = this.getOrCreate(threadId);
        await session.onReceiveMessage(query, args);
    }

    async onReceiveWebMessage(threadId: string, query: MessageContent, sessionId?: string): Promise<void> {
        if (isEmptyContent(query)) return;
        const session = this.getOrCreate(threadId);
        await session.onReceiveMessage(query, { channelType: WEB_CHANNEL, sessionId });
    }

    // ── Trigger action routing ──

    async onChannelTriggerAction(threadId: string, args: any): Promise<void> {
        const session = this.getSession(threadId) as SbotSession | undefined;
        await session?.triggerAction(args);
    }

    async onWebTriggerAction(threadId: string, type: string, msg: Record<string, any>): Promise<void> {
        const session = this.getSession(threadId) as SbotSession | undefined;
        await session?.triggerAction(type, msg);
    }
}

export const sessionManager = new SbotSessionManager();
