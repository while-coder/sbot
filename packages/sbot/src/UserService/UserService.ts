import "reflect-metadata";
import { LarkMessageArgs } from "channel.lark";
import { SlackMessageArgs, SlackActionArgs } from "channel.slack";
import { AgentMessage, AgentToolCall, ICommand, SaverContext, ToolApproval, UserServiceBase } from "scorpio.ai";
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
    async onReceiveLarkMessage(query: string, args: LarkMessageArgs, userInfo: any, channelId: string, dbSessionId?: number, dbUserId?: number) {
        if (!query?.trim()) return;
        await this.onReceiveMessage(query, { ...args, channelType: ChannelType.Lark, userInfo, channelId, dbSessionId, dbUserId });
    }

    async onReceiveSlackMessage(
        query: string,
        args: SlackMessageArgs,
        userInfo: any,
        channelId: string,
        dbSessionId?: number,
        dbUserId?: number,
    ): Promise<void> {
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

    protected override async resolveSaverContext(args: any): Promise<SaverContext | undefined> {
        const workPath  = args?.workPath  as string | undefined;
        const sessionId = args?.sessionId as string | undefined;
        const channelId = args?.channelId as string | undefined;

        if (workPath) {
            const cfg = config.getDirectoryConfig(workPath);
            if (!cfg?.saver) return undefined;
            return { saverId: cfg.saver, threadId: dirThreadId(workPath) };
        }
        if (sessionId) {
            const session = config.getSession(sessionId);
            if (!session?.saver) return undefined;
            return { saverId: session.saver, threadId: sessionThreadId(sessionId) };
        }
        if (channelId) {
            const channel = config.getChannel(channelId);
            if (!channel?.saver) return undefined;
            if (args.channelType === ChannelType.Lark) {
                return { saverId: channel.saver, threadId: larkThreadId(channelId, args.chat_id) };
            } else {
                return { saverId: channel.saver, threadId: slackThreadId(channelId, args.channel, args.threadTs ?? args.ts) };
            }
        }
        return undefined;
    }

    async startProcessMessage(query: string, args: any): Promise<string> {
        this.currentContext = args?.channelType ?? ChannelType.Lark;
        if (this.currentContext === ChannelType.Slack) return await this.slack.startProcessMessage(query, args);
        if (this.currentContext === ChannelType.Lark) return await this.lark.startProcessMessage(query, args);
        if (this.currentContext === ChannelType.Http) return await this.http.startProcessMessage(query, args);
        return await this.web.startProcessMessage(query, args);
    }

    async onMessageProcessed(_query: string, _args: any): Promise<void> {
        if (this.currentContext === ChannelType.Web) await this.web.onMessageProcessed();
        else if (this.currentContext === ChannelType.Http) await this.http.onMessageProcessed();
        else if (this.currentContext === ChannelType.Slack) { /* no-op */ }
        this.currentContext = undefined;
    }

    async processMessageError(e: any): Promise<void> {
        if (this.currentContext === ChannelType.Lark) await this.lark.processMessageError(e);
        else if (this.currentContext === ChannelType.Slack) await this.slack.processMessageError(e);
        else if (this.currentContext === ChannelType.Web) await this.web.processMessageError(e);
        else if (this.currentContext === ChannelType.Http) await this.http.processMessageError(e);
    }

    async onAgentMessage(message: AgentMessage): Promise<void> {
        if (this.currentContext === ChannelType.Lark) await this.lark.onAgentMessage(message);
        else if (this.currentContext === ChannelType.Slack) await this.slack.onAgentMessage(message);
        else if (this.currentContext === ChannelType.Web) await this.web.onAgentMessage(message);
        else if (this.currentContext === ChannelType.Http) await this.http.onAgentMessage(message);
    }

    async onAgentStreamMessage(message: AgentMessage): Promise<void> {
        if (this.currentContext === ChannelType.Lark) await this.lark.onAgentStreamMessage(message);
        else if (this.currentContext === ChannelType.Slack) await this.slack.onAgentStreamMessage(message);
        else if (this.currentContext === ChannelType.Web) await this.web.onAgentStreamMessage(message);
        else if (this.currentContext === ChannelType.Http) await this.http.onAgentStreamMessage(message);
    }

    async executeAgentTool(toolCall: AgentToolCall): Promise<ToolApproval> {
        if (this.currentContext === ChannelType.Lark) return await this.lark.executeAgentTool(toolCall);
        if (this.currentContext === ChannelType.Slack) return await this.slack.executeAgentTool(toolCall);
        if (this.currentContext === ChannelType.Http) return await this.http.executeAgentTool(toolCall);
        return await this.web.executeAgentTool(toolCall);
    }


    async processAIMessage(query: string, args: any): Promise<void> {
        if (this.currentContext === ChannelType.Lark) await this.lark.processAIMessage(query, args);
        else if (this.currentContext === ChannelType.Slack) await this.slack.processAIMessage(query, args);
        else if (this.currentContext === ChannelType.Http) await this.http.processAIMessage(query, args);
        else await this.web.processAIMessage(query, args);
    }
}

export const userService = new UserService();
