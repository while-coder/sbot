import "reflect-metadata";
import { LarkUserServiceBase } from "winning.ai";
import { ICommand } from "scorpio.ai";
import { AgentRunner } from "../Agent/AgentRunner";
import { config } from "../Core/Config";

export class LarkUserService extends LarkUserServiceBase {
    protected async getAllCommands(): Promise<ICommand[]> { return []; }
    async processAIMessage(query: string, args: any): Promise<void> {
        const channel = config.getChannel(args?.channelId);
        if (!channel) throw new Error(`频道 "${args?.channelId}" 不存在`);
        await AgentRunner.run(query, {
            onMessage: this.onAgentMessage.bind(this),
            onStreamMessage: this.onAgentStreamMessage.bind(this),
            executeTool: this.executeAgentTool.bind(this),
            askUser: this.askUser.bind(this),
            convertImages: this.convertImages.bind(this),
        }, channel.agent, channel.saver, `channel_${args?.channelId}`, args?.userInfo, channel.memory);
    }
}
