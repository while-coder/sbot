import "reflect-metadata";
import { LarkMessageArgs } from "channel.lark";
import { AgentMessage, AgentToolCall, ICommand, ToolApproval, UserServiceBase } from "scorpio.ai";
import { getBuiltInCommands } from "./BuiltInCommands";
import { LarkUserService } from "./LarkUserService";
import { WebSocketUserService } from "./WebSocketUserService";
import { HttpUserService } from "./HttpUserService";

enum Context { Lark = 'lark', Web = 'web', Http = 'http' }

export class UserService extends UserServiceBase {
    readonly lark: LarkUserService;
    readonly web: WebSocketUserService;
    readonly http: HttpUserService;

    private currentContext: Context | undefined;

    constructor() {
        super();
        this.lark = new LarkUserService();
        this.web = new WebSocketUserService();
        this.http = new HttpUserService();
    }

    // 重定向到共享队列（UserService），而非本地队列
    async onReceiveLarkMessage(query: string, args: LarkMessageArgs, userInfo: any, channelId: string, dbSessionId?: number, dbUserId?: number) {
        if (!query?.trim()) return;
        await this.onReceiveMessage(query, { ...args, userInfo, channelId, dbSessionId, dbUserId });
    }
    async onReceiveWebMessage(query: string, ws: any, sessionId?: string, workPath?: string): Promise<void> {
        if (!query?.trim()) return;
        return new Promise<void>((resolve) => {
            this.onReceiveMessage(query, { webContext: true, ws, sessionId, workPath }, resolve);
        });
    }

    async onReceiveHttpMessage(query: string, res: any, sessionId?: string, workPath?: string): Promise<void> {
        if (!query?.trim()) return;
        return new Promise<void>((resolve) => {
            this.onReceiveMessage(query, { httpContext: true, sessionId, workPath, res }, resolve);
        });
    }

    protected async getAllCommands(): Promise<ICommand[]> {
        return getBuiltInCommands();
    }

    async startProcessMessage(query: string, args: any): Promise<string> {
        if (args?.webContext) this.currentContext = Context.Web;
        else if (args?.httpContext) this.currentContext = Context.Http;
        else this.currentContext = Context.Lark;
        if (this.currentContext === Context.Lark) return await this.lark.startProcessMessage(query, args);
        if (this.currentContext === Context.Http) return await this.http.startProcessMessage(query, args);
        return await this.web.startProcessMessage(query, args);
    }

    async onMessageProcessed(_query: string, _args: any): Promise<void> {
        if (this.currentContext === Context.Web) await this.web.onMessageProcessed();
        else if (this.currentContext === Context.Http) await this.http.onMessageProcessed();
        this.currentContext = undefined;
    }

    async processMessageError(e: any): Promise<void> {
        if (this.currentContext === Context.Lark) await this.lark.processMessageError(e);
        else if (this.currentContext === Context.Web) await this.web.processMessageError(e);
        else if (this.currentContext === Context.Http) await this.http.processMessageError(e);
    }

    async onAgentMessage(message: AgentMessage): Promise<void> {
        if (this.currentContext === Context.Lark) await this.lark.onAgentMessage(message);
        else if (this.currentContext === Context.Web) await this.web.onAgentMessage(message);
        else if (this.currentContext === Context.Http) await this.http.onAgentMessage(message);
    }

    async onAgentStreamMessage(message: AgentMessage): Promise<void> {
        if (this.currentContext === Context.Lark) await this.lark.onAgentStreamMessage(message);
        else if (this.currentContext === Context.Web) await this.web.onAgentStreamMessage(message);
        else if (this.currentContext === Context.Http) await this.http.onAgentStreamMessage(message);
    }

    async executeAgentTool(toolCall: AgentToolCall): Promise<ToolApproval> {
        if (this.currentContext === Context.Lark) return await this.lark.executeAgentTool(toolCall);
        if (this.currentContext === Context.Http) return await this.http.executeAgentTool(toolCall);
        return await this.web.executeAgentTool(toolCall);
    }


    async processAIMessage(query: string, args: any): Promise<void> {
        if (this.currentContext === Context.Lark) await this.lark.processAIMessage(query, args);
        else if (this.currentContext === Context.Http) await this.http.processAIMessage(query, args);
        else await this.web.processAIMessage(query, args);
    }
}

export const userService = new UserService();
