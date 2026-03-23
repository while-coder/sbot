import "reflect-metadata";
import { LarkMessageArgs, LarkUserServiceBase } from "channel.lark";
import { AgentRunner } from "../Agent/AgentRunner";
import { config } from "../Core/Config";
import { ChannelSessionRow, SchedulerType, database } from "../Core/Database";
import { buildExecuteTool } from "./buildExecuteTool";
import { larkThreadId } from "sbot.commons";
import { sessionManager } from "channel.base";

export class LarkUserService extends LarkUserServiceBase {

    protected onCancelAction(): void {
        if (this.threadId) sessionManager.abort(this.threadId);
    }

    async processAIMessage(query: string, args: any): Promise<void> {
        const channelId = args?.channelId as string;
        const channel = channelId ? config.getChannel(channelId) : undefined;
        if (!channel) throw new Error(`Channel "${channelId}" not found`);
        const { chat_id } = args as LarkMessageArgs;

        const userInfo = args?.userInfo;
        const dbSessionId: number = args?.dbSessionId;
        if (!dbSessionId) throw new Error('dbSessionId not specified');

        const dbSession = await database.findByPk<ChannelSessionRow>(database.channelSession, dbSessionId);

        const agentId  = dbSession?.agentId  || channel.agent;
        const memoryId = dbSession?.memoryId || channel.memory;

        const extraInfo = userInfo ? `<lark-user>
  <name>${userInfo.name}</name>
  <email>${userInfo.email}</email>
  <user-id>${userInfo.user_id}</user-id>
  <open-id>${userInfo.open_id}</open-id>
  <union-id>${userInfo.union_id}</union-id>
</lark-user>` : '';

        this.threadId = larkThreadId(channelId, chat_id);
        await AgentRunner.run({
            query,
            callbacks: {
                onMessage: this.onAgentMessage.bind(this),
                onStreamMessage: this.onAgentStreamMessage.bind(this),
                executeTool: buildExecuteTool(this.threadId, this.executeAgentTool.bind(this)),
            },
            agentId,
            saverId: channel.saver,
            threadId: this.threadId,
            schedulerType: SchedulerType.Channel,
            schedulerId: String(dbSessionId),
            extraInfo,
            memoryId,
            askFn: this.ask.bind(this),
        });
    }
}
