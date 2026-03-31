import "reflect-metadata";
import { LarkMessageArgs, LarkActionArgs } from "channel.lark";
import { SlackMessageArgs, SlackActionArgs } from "channel.slack";
import { WecomMessageArgs, WecomActionArgs } from "channel.wecom";
import { ICommand, MessageType } from "scorpio.ai";
import { SessionManager, SessionService } from "channel.base";
import { larkThreadId, slackThreadId, wecomThreadId, ChannelType, WsCommandType } from "sbot.commons";
import { config } from "../Core/Config";

import { getBuiltInCommands } from "./BuiltInCommands";
import { LarkUserService } from "./channels/LarkUserService";
import { SlackUserService } from "./channels/SlackUserService";
import { WecomUserService } from "./channels/WecomUserService";
import { WebSocketUserService } from "./web/WebSocketUserService";

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
            this.channel = this.manager.createChannel(args?.channelType, this);
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
            const workPath = args?.workPath as string | undefined;
            if (workPath) return config.getDirectoryConfig(workPath)?.saver;
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

    createChannel(type: string, session: SessionService): any {
        switch (type) {
            case ChannelType.Lark:  return new LarkUserService(session);
            case ChannelType.Slack: return new SlackUserService(session);
            case ChannelType.Wecom: return new WecomUserService(session);
            default:                return new WebSocketUserService(session);
        }
    }

    // ── Channel entry points ──

    async onReceiveLarkMessage(query: string, args: LarkMessageArgs, userInfo: any, channelId: string, dbSessionId?: number): Promise<void> {
        if (!query?.trim()) return;
        const threadId = larkThreadId(channelId, args.chat_id);
        const session = this.getOrCreate(threadId);
        await session.onReceiveMessage(query, { ...args, channelType: ChannelType.Lark, userInfo, channelId, dbSessionId });
    }

    async onReceiveSlackMessage(query: string, args: SlackMessageArgs, userInfo: any, channelId: string, dbSessionId?: number): Promise<void> {
        if (!query?.trim()) return;
        const threadId = slackThreadId(channelId, args.channel);
        const session = this.getOrCreate(threadId);
        await session.onReceiveMessage(query, { ...args, channelType: ChannelType.Slack, userInfo, channelId, dbSessionId });
    }

    async onReceiveWecomMessage(query: string, args: WecomMessageArgs, userInfo: any, channelId: string, dbSessionId?: number): Promise<void> {
        if (!query?.trim()) return;
        const threadId = wecomThreadId(channelId, args.chatid);
        const session = this.getOrCreate(threadId);
        await session.onReceiveMessage(query, { ...args, channelType: ChannelType.Wecom, userInfo, channelId, dbSessionId });
    }

    async onReceiveWebMessage(query: string, threadId: string, sessionId?: string, workPath?: string): Promise<void> {
        if (!query?.trim()) return;
        const session = this.getOrCreate(threadId);
        await session.onReceiveMessage(query, { channelType: ChannelType.Web, sessionId, workPath });
    }

    // ── Trigger action routing ──

    async onLarkTriggerAction(channelId: string, args: LarkActionArgs): Promise<void> {
        const threadId = larkThreadId(channelId, args.chat_id);
        const session = this.getSession(threadId) as SbotSession | undefined;
        await session?.triggerAction(args);
    }

    async onSlackTriggerAction(channelId: string, args: SlackActionArgs): Promise<void> {
        const threadId = slackThreadId(channelId, args.channel);
        const session = this.getSession(threadId) as SbotSession | undefined;
        await session?.triggerAction(args);
    }

    async onWecomTriggerAction(channelId: string, args: WecomActionArgs): Promise<void> {
        const threadId = wecomThreadId(channelId, args.chatid);
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
