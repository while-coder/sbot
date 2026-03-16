import "reflect-metadata";
import { LarkMessageArgs, LarkUserServiceBase } from "channel.lark";
import { ICommand } from "scorpio.ai";
import { AgentRunner } from "../Agent/AgentRunner";
import { config } from "../Core/Config";
import { ContextType } from "../Core/Database";

export class LarkUserService extends LarkUserServiceBase {
    protected async getAllCommands(): Promise<ICommand[]> { return []; }
    async processAIMessage(query: string, args: any): Promise<void> {
        const channelId = args?.channelId as string;
        const channel = channelId ? config.getChannel(channelId) : undefined;
        if (!channel) throw new Error(`频道 "${channelId}" 不存在`);
        const { chat_id } = args as LarkMessageArgs;
        await AgentRunner.run(query, {
            onMessage: this.onAgentMessage.bind(this),
            onStreamMessage: this.onAgentStreamMessage.bind(this),
            executeTool: this.executeAgentTool.bind(this),
            convertImages: this.convertImages.bind(this),
        }, channel.agent, channel.saver, `lark_${channelId}_${chat_id}`, ContextType.Channel, channel.memory, args?.userInfo);
    }
}
