import "reflect-metadata";
import { LarkMessageArgs } from "channel.lark";
import { SlackMessageArgs, SlackActionArgs } from "channel.slack";
import { WecomMessageArgs, WecomActionArgs } from "channel.wecom";
import { ICommand, MessageType } from "scorpio.ai";
import { SessionManager, SessionService } from "channel.base";
import { larkThreadId, slackThreadId, wecomThreadId, ChannelType } from "sbot.commons";

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
        super(threadId);
        this.manager = manager;
    }

    private getChannel(args: any) {
        if (!this.channel) {
            this.channel = this.manager.createChannel(args?.channelType, this.threadId);
        }
        return this.channel;
    }

    protected async onProcessStart(query: string, args: any, messageType: MessageType): Promise<void> {
        await this.getChannel(args).onProcessStart(query, args, messageType);
    }

    protected async processAI(query: string, args: any): Promise<void> {
        await this.getChannel(args).processAI(query, args);
    }

    protected async onCommandResult(content: string, args: any): Promise<void> {
        await this.getChannel(args).onCommandResult(content, args);
    }

    protected async onProcessEnd(query: string, args: any, messageType: MessageType, error?: any): Promise<void> {
        await this.getChannel(args).onProcessEnd(query, args, messageType, error);
    }

    protected async getAllCommands(): Promise<ICommand[]> {
        return getBuiltInCommands();
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

    createChannel(type: string, threadId: string): any {
        switch (type) {
            case ChannelType.Lark:  return new LarkUserService(this, threadId);
            case ChannelType.Slack: return new SlackUserService(this, threadId);
            case ChannelType.Wecom: return new WecomUserService(this, threadId);
            default:                return new WebSocketUserService(this, threadId);
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

    async onLarkTriggerAction(channelId: string, chatId: string, code: string, data: any, formValue: any): Promise<void> {
        const threadId = larkThreadId(channelId, chatId);
        const session = this.getSession(threadId) as SbotSession | undefined;
        await session?.triggerAction(chatId, code, data, formValue);
    }

    async onSlackTriggerAction(channelId: string, args: SlackActionArgs): Promise<void> {
        const threadId = slackThreadId(channelId, args.channel);
        const session = this.getSession(threadId) as SbotSession | undefined;
        await session?.triggerAction(args);
    }

    async onWecomTriggerAction(channelId: string, userId: string, args: WecomActionArgs): Promise<void> {
        const threadId = wecomThreadId(channelId, args.chatid);
        const session = this.getSession(threadId) as SbotSession | undefined;
        await session?.triggerAction(userId, args);
    }
}

export const sessionManager = new SbotSessionManager();
