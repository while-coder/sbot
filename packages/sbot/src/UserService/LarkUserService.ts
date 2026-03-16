import "reflect-metadata";
import { LarkMessageArgs, LarkUserServiceBase } from "channel.lark";
import { ICommand } from "scorpio.ai";
import { AgentRunner } from "../Agent/AgentRunner";
import { config } from "../Core/Config";
import { ChannelSessionRow, ContextType, database } from "../Core/Database";

export class LarkUserService extends LarkUserServiceBase {
    protected async getAllCommands(): Promise<ICommand[]> { return []; }
    async processAIMessage(query: string, args: any): Promise<void> {
        const channelId = args?.channelId as string;
        const channel = channelId ? config.getChannel(channelId) : undefined;
        if (!channel) throw new Error(`频道 "${channelId}" 不存在`);
        const { chat_id } = args as LarkMessageArgs;

        const userInfo = args?.userInfo;
        const dbSessionId: number = args?.dbSessionId;
        if (!dbSessionId) throw new Error('未指定 dbSessionId');

        const dbSession = await database.findByPk<ChannelSessionRow>(database.channelSession, dbSessionId);

        const agentId  = dbSession?.agentId  || channel.agent;
        const memoryId = dbSession?.memoryId || channel.memory;

        const schedulerId = `<scheduler-id>${dbSessionId}</scheduler-id>`;
        const extraInfo = userInfo ? `${schedulerId}
<current-user>
  <id>${userInfo.user_id}</id>
  <open-id>${userInfo.open_id}</open-id>
  <union-id>${userInfo.union_id}</union-id>
  <name>${userInfo.name}</name>
  <email>${userInfo.email}</email>
</current-user>` : schedulerId;

        await AgentRunner.run(query, {
            onMessage: this.onAgentMessage.bind(this),
            onStreamMessage: this.onAgentStreamMessage.bind(this),
            executeTool: this.executeAgentTool.bind(this),
            convertImages: this.convertImages.bind(this),
        }, agentId, channel.saver, `lark_${channelId}_${chat_id}`, ContextType.Channel, extraInfo, memoryId);
    }
}
