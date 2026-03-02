import "reflect-metadata";
import { LarkUserServiceBase, LarkMessageArgs } from "winning.ai";
import { ICommand } from "scorpio.ai";
import { AgentRunner } from "../AgentRunner";
import type { UserService } from "./UserService";

export class LarkUserService extends LarkUserServiceBase {
    constructor(private readonly userService: UserService) {
        super();
    }

    protected async getAllCommands(): Promise<ICommand[]> { return []; }

    async processAIMessage(query: string, args: any): Promise<void> {
        await AgentRunner.run(query, {
            onMessage: this.onAgentMessage.bind(this),
            onStreamMessage: this.onAgentStreamMessage.bind(this),
            executeTool: this.executeAgentTool.bind(this),
            askUser: this.askUser.bind(this),
            convertImages: this.convertImages.bind(this),
        }, args?.userInfo);
    }
}
