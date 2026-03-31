import "reflect-metadata";
import { LarkMessageArgs } from "channel.lark";
import { SlackMessageArgs } from "channel.slack";
import { WecomMessageArgs } from "channel.wecom";
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
    private channelType?: ChannelType;

    constructor(threadId: string, manager: SbotSessionManager) {
        super(threadId);
        this.manager = manager;
    }

    protected async startProcessMessage(query: string, args: any, messageType: MessageType): Promise<string> {
        this.channelType = args?.channelType;
        const channel = this.manager.getChannel(this.channelType!);
        return channel.startProcessMessage(query, args, messageType);
    }

    protected async processAIMessage(query: string, args: any): Promise<void> {
        const channel = this.manager.getChannel(this.channelType!);
        await channel.processAIMessage(query, args, this.threadId);
    }

    protected async processMessageError(e: any, args: any, messageType: MessageType): Promise<void> {
        const channel = this.manager.getChannel(this.channelType!);
        await channel.processMessageError(e, args, messageType);
    }

    protected async onCommandOutput(content: string, args: any): Promise<void> {
        const channelType = args?.channelType as ChannelType | undefined;
        const channel = this.manager.getChannel(channelType ?? this.channelType!);
        await channel.onCommandOutput(content, args);
    }

    protected async onMessageProcessed(query: string, args: any, messageType: MessageType): Promise<void> {
        const channel = this.manager.getChannel(this.channelType!);
        if (channel.onMessageProcessed) await channel.onMessageProcessed(args, messageType);
        this.channelType = undefined;
    }

    protected async getAllCommands(): Promise<ICommand[]> {
        return getBuiltInCommands();
    }
}

// ── Session manager singleton ──

export class SbotSessionManager extends SessionManager {
    readonly lark: LarkUserService;
    readonly slack: SlackUserService;
    readonly wecom: WecomUserService;
    readonly web: WebSocketUserService;

    constructor() {
        super();
        this.lark  = new LarkUserService(this);
        this.slack  = new SlackUserService(this);
        this.wecom = new WecomUserService(this);
        this.web   = new WebSocketUserService(this);
    }

    protected createSession(threadId: string): SessionService {
        return new SbotSession(threadId, this);
    }

    getChannel(type: string): any {
        switch (type) {
            case ChannelType.Lark:  return this.lark;
            case ChannelType.Slack: return this.slack;
            case ChannelType.Wecom: return this.wecom;
            default:                return this.web;
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

}

export const sessionManager = new SbotSessionManager();
