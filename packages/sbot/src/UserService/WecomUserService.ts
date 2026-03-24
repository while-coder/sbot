import "reflect-metadata";
import { WecomMessageArgs, WecomUserServiceBase } from "channel.wecom";
import { AgentRunner } from "../Agent/AgentRunner";
import { config } from "../Core/Config";
import { ChannelSessionRow, SchedulerType, database } from "../Core/Database";
import { buildExecuteTool } from "./buildExecuteTool";
import { wecomThreadId } from "sbot.commons";
import { sessionManager } from "channel.base";

export class WecomUserService extends WecomUserServiceBase {

    protected onAbortAction(): void {
        if (this.threadId) sessionManager.abort(this.threadId);
    }

    async processAIMessage(query: string, args: any): Promise<void> {
        const channelId = args?.channelId as string;
        const channel = channelId ? config.getChannel(channelId) : undefined;
        if (!channel) throw new Error(`Channel "${channelId}" not found`);
        const { chatid } = args as WecomMessageArgs;

        const userInfo = args?.userInfo;
        const dbSessionId: number = args?.dbSessionId;
        if (!dbSessionId) throw new Error('dbSessionId not specified');

        const dbSession = await database.findByPk<ChannelSessionRow>(database.channelSession, dbSessionId);

        const agentId  = dbSession?.agentId  || channel.agent;
        const memoryId = dbSession?.memoryId || channel.memory;
        const workPath = dbSession?.workPath  || undefined;

        const extraInfo = userInfo ? `<wecom-user>
  <userid>${userInfo.userid}</userid>
</wecom-user>` : '';

        this.threadId = wecomThreadId(channelId, chatid);
        await AgentRunner.run({
            query,
            callbacks: {
                onMessage: this.onAgentMessage.bind(this),
                onStreamMessage: async (msg) => { await this.provider?.setStreamMessage(msg.content ?? ''); },
                executeTool: buildExecuteTool(this.threadId, this.executeAgentTool.bind(this)),
            },
            agentId,
            saverId: channel.saver,
            threadId: this.threadId,
            schedulerType: SchedulerType.Channel,
            schedulerId: String(dbSessionId),
            extraInfo,
            memoryId,
            workPath,
            askFn: this.ask.bind(this),
        });
    }
}
