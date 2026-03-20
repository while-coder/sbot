import "reflect-metadata";
import { LarkMessageArgs } from "channel.lark";
import { SlackMessageArgs } from "channel.slack";
import { ICommand, MessageType, SaverContext, UserServiceBase } from "scorpio.ai";
import { dirThreadId, larkThreadId, sessionThreadId, slackThreadId } from "sbot.commons";
import { config } from "../Core/Config";
import { getBuiltInCommands } from "./BuiltInCommands";
import { LarkUserService } from "./LarkUserService";
import { SlackUserService } from "./SlackUserService";
import { WebSocketUserService } from "./WebSocketUserService";
import { HttpUserService } from "./HttpUserService";

enum ChannelType { Lark = 'lark', Slack = 'slack', Web = 'web', Http = 'http' }

export class UserService extends UserServiceBase {
    readonly lark: LarkUserService;
    readonly slack: SlackUserService;
    readonly web: WebSocketUserService;
    readonly http: HttpUserService;

    private currentContext: ChannelType | undefined;

    constructor() {
        super();
        this.lark = new LarkUserService();
        this.slack = new SlackUserService();
        this.web = new WebSocketUserService();
        this.http = new HttpUserService();
    }

    // 重定向到共享队列（UserService），而非本地队列
    async onReceiveLarkMessage(query: string, args: LarkMessageArgs, userInfo: any, channelId: string, dbSessionId?: number, dbUserId?: number): Promise<void> {
        if (!query?.trim()) return;
        await this.onReceiveMessage(query, { ...args, channelType: ChannelType.Lark, userInfo, channelId, dbSessionId, dbUserId });
    }

    async onReceiveSlackMessage(query: string, args: SlackMessageArgs, userInfo: any, channelId: string, dbSessionId?: number, dbUserId?: number): Promise<void> {
        if (!query?.trim()) return;
        await this.onReceiveMessage(query, { ...args, channelType: ChannelType.Slack, userInfo, channelId, dbSessionId, dbUserId });
    }

    async onReceiveWebMessage(query: string, sessionId?: string, workPath?: string): Promise<void> {
        if (!query?.trim()) return;
        return new Promise<void>((resolve) => {
            this.onReceiveMessage(query, { channelType: ChannelType.Web, sessionId, workPath }, resolve);
        });
    }

    async onReceiveHttpMessage(query: string, res: any, sessionId?: string, workPath?: string): Promise<void> {
        if (!query?.trim()) return;
        return new Promise<void>((resolve) => {
            this.onReceiveMessage(query, { channelType: ChannelType.Http, sessionId, workPath, res }, resolve);
        });
    }

    protected async getAllCommands(): Promise<ICommand[]> {
        return getBuiltInCommands();
    }

    protected async resolveSaverContext(args: any): Promise<SaverContext | undefined> {
        const channelType = args?.channelType as ChannelType | undefined;
        if (channelType === ChannelType.Lark) {
            const channel = config.getChannel(args.channelId);
            if (!channel?.saver) return undefined;
            return { saverId: channel.saver, threadId: larkThreadId(args.channelId, args.chat_id) };
        }
        if (channelType === ChannelType.Slack) {
            const channel = config.getChannel(args.channelId);
            if (!channel?.saver) return undefined;
            return { saverId: channel.saver, threadId: slackThreadId(args.channelId, args.channel) };
        }
        if (args?.workPath) {
            const cfg = config.getDirectoryConfig(args.workPath);
            if (!cfg?.saver) return undefined;
            return { saverId: cfg.saver, threadId: dirThreadId(args.workPath) };
        }
        if (args?.sessionId) {
            const session = config.getSession(args.sessionId);
            if (!session?.saver) return undefined;
            return { saverId: session.saver, threadId: sessionThreadId(args.sessionId) };
        }
        return undefined;
    }

    protected async startProcessMessage(query: string, args: any, messageType: MessageType): Promise<string> {
        this.currentContext = args?.channelType ?? ChannelType.Lark;
        if (this.currentContext === ChannelType.Slack) return await this.slack.startProcessMessage(query, args, messageType);
        if (this.currentContext === ChannelType.Lark) return await this.lark.startProcessMessage(query, args, messageType);
        if (this.currentContext === ChannelType.Http) return await this.http.startProcessMessage(query, args, messageType);
        return await this.web.startProcessMessage(query, args, messageType);
    }

    protected async onMessageProcessed(_query: string, args: any, messageType: MessageType): Promise<void> {
        if (this.currentContext === ChannelType.Web) await this.web.onMessageProcessed(args, messageType);
        else if (this.currentContext === ChannelType.Http) await this.http.onMessageProcessed(args, messageType);
        else if (this.currentContext === ChannelType.Lark) await this.lark.onMessageProcessed(args, messageType);
        this.currentContext = undefined;
    }

    protected async processMessageError(e: any, args: any, messageType: MessageType): Promise<void> {
        if (this.currentContext === ChannelType.Lark) await this.lark.processMessageError(e, args, messageType);
        else if (this.currentContext === ChannelType.Slack) await this.slack.processMessageError(e, args, messageType);
        else if (this.currentContext === ChannelType.Web) await this.web.processMessageError(e, args, messageType);
        else if (this.currentContext === ChannelType.Http) await this.http.processMessageError(e, args, messageType);
    }

    protected async onCommandOutput(content: string, args: any): Promise<void> {
        const channelType = args?.channelType ?? ChannelType.Lark;
        if (channelType === ChannelType.Lark) await this.lark.onCommandOutput(content, args);
        else if (channelType === ChannelType.Slack) await this.slack.onCommandOutput(content, args);
        else if (channelType === ChannelType.Web) await this.web.onCommandOutput(content, args);
        else if (channelType === ChannelType.Http) await this.http.onCommandOutput(content, args);
    }

    async processAIMessage(query: string, args: any): Promise<void> {
        if (this.currentContext === ChannelType.Lark) await this.lark.processAIMessage(query, args);
        else if (this.currentContext === ChannelType.Slack) await this.slack.processAIMessage(query, args);
        else if (this.currentContext === ChannelType.Http) await this.http.processAIMessage(query, args);
        else await this.web.processAIMessage(query, args);
    }
}

export const userService = new UserService();
