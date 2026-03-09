import "reflect-metadata";
import { LarkUserServiceBase, LarkMessageArgs } from "winning.ai";
import { ICommand } from "scorpio.ai";
import { AgentRunner } from "../Agent/AgentRunner";
import { config } from "../Core/Config";

export class LarkUserService extends LarkUserServiceBase {
    protected async getAllCommands(): Promise<ICommand[]> { return []; }
    async processAIMessage(query: string, args: any): Promise<void> {
        const channel = config.getChannel(args?.channelId);
        await AgentRunner.run(query, {
            onMessage: this.onAgentMessage.bind(this),
            onStreamMessage: this.onAgentStreamMessage.bind(this),
            executeTool: this.executeAgentTool.bind(this),
            askUser: this.askUser.bind(this),
            convertImages: this.convertImages.bind(this),
        }, args?.userInfo, channel?.agent ?? args?.agentName, channel?.saver, channel?.memory);
    }
}
