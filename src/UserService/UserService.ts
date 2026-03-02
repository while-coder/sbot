import "reflect-metadata";
import { LarkMessageArgs, UserServiceBase } from "winning.ai";
import { AgentMessage, AgentToolCall, ICommand } from "scorpio.ai";
import { getBuiltInCommands } from "./BuiltInCommands";
import { LarkUserService } from "./LarkUserService";
import { WebUserService, WebEmitFn } from "./WebUserService";

enum Context { Lark = 'lark', Web = 'web' }

export class UserService extends UserServiceBase {
    readonly lark: LarkUserService;
    readonly web: WebUserService;

    private currentContext: Context | undefined;

    constructor() {
        super();
        this.lark = new LarkUserService(this);
        this.web = new WebUserService();
    }

    // 重定向到共享队列（UserService），而非本地队列
    async onReceiveLarkMessage(args: LarkMessageArgs, userInfo: any, query: string) {
        if (!query?.trim()) return;
        await this.onReceiveMessage(query, { ...args, userInfo });
    }
    async onReceiveWebMessage(query: string, emitFn: WebEmitFn): Promise<void> {
        if (!query?.trim()) return;
        return new Promise<void>((resolve) => {
            this.onReceiveMessage(query, { emitFn }, resolve);
        });
    }

    protected async getAllCommands(): Promise<ICommand[]> {
        return getBuiltInCommands();
    }

    async startProcessMessage(query: string, args: any): Promise<string> {
        this.currentContext = args?.emitFn ? Context.Web : Context.Lark;
        return this.currentContext === Context.Lark
            ? await this.lark.startProcessMessage(query, args)
            : await this.web.startProcessMessage(query, args);
    }

    async onMessageProcessed(_query: string, _args: any): Promise<void> {
        if (this.currentContext === Context.Web) await this.web.onMessageProcessed();
        this.currentContext = undefined;
    }

    async processMessageError(e: any): Promise<void> {
        if (this.currentContext === Context.Lark) await this.lark.processMessageError(e);
        else if (this.currentContext === Context.Web) await this.web.processMessageError(e);
    }

    async onAgentMessage(message: AgentMessage): Promise<void> {
        if (this.currentContext === Context.Lark) await this.lark.onAgentMessage(message);
        else if (this.currentContext === Context.Web) await this.web.onAgentMessage(message);
    }

    async onAgentStreamMessage(message: AgentMessage): Promise<void> {
        if (this.currentContext === Context.Lark) await this.lark.onAgentStreamMessage(message);
        else if (this.currentContext === Context.Web) await this.web.onAgentStreamMessage(message);
    }

    async executeAgentTool(toolCall: AgentToolCall): Promise<boolean> {
        if (this.currentContext === Context.Lark) return await this.lark.executeAgentTool(toolCall);
        return await this.web.executeAgentTool(toolCall);
    }

    async askUser(question: string): Promise<string> {
        if (this.currentContext === Context.Lark) return await this.lark.askUser(question);
        return await this.web.askUser(question);
    }

    async processAIMessage(query: string, args: any): Promise<void> {
        if (this.currentContext === Context.Lark) await this.lark.processAIMessage(query, args);
        else await this.web.processAIMessage(query, args);
    }
}

export const userService = new UserService();
