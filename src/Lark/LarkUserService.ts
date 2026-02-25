import "reflect-metadata";
import { LarkUserServiceBase } from "winning.ai";
import { ICommand } from "scorpio.ai";
import { getBuiltInCommands } from "../UserService/BuiltInCommands";
import { AgentRunner } from "../AgentRunner";

export class LarkUserService extends LarkUserServiceBase {
    static allUsers = new Map<string, LarkUserService>();
    static getUserAgentService(userId: string): LarkUserService {
        if (LarkUserService.allUsers.has(userId)) {
            return LarkUserService.allUsers.get(userId)!;
        }
        const user = new LarkUserService(userId);
        LarkUserService.allUsers.set(userId, user);
        return user;
    }

    constructor(userId: string) {
        super(userId);
    }

    protected async getAllCommands(): Promise<ICommand[]> {
        return getBuiltInCommands();
    }

    protected async processAIMessage(query: string, _args: any): Promise<void> {
        await AgentRunner.run(this.userId, query, {
            onMessage: this.onAgentMessage.bind(this),
            onStreamMessage: this.onAgentStreamMessage.bind(this),
            executeTool: this.executeAgentTool.bind(this),
            convertImages: this.convertImages.bind(this),
        }, this.userInfo);
    }
}
