import "reflect-metadata";
import { WecomMessageArgs, WecomUserServiceBase } from "channel.wecom";
import { AgentRunner } from "../Agent/AgentRunner";
import { config } from "../Core/Config";
import { ChannelSessionRow, SchedulerType, database, parseMemories } from "../Core/Database";
import { buildExecuteTool } from "./buildExecuteTool";
import { wecomThreadId, ChannelType } from "sbot.commons";
import { sessionManager } from "channel.base";
import { AskQuestionType } from "scorpio.ai";
import { createAskAgentTool } from "../Agent/AgentRunner";

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
        const memoryId = dbSession?.useChannelMemories ? channel.memories[0] : (parseMemories(dbSession?.memories)[0] ?? channel.memories[0]);
        const workPath = dbSession?.workPath  || undefined;

        const extraInfo = userInfo ? `<wecom-user>
  <userid>${userInfo.userid}</userid>
</wecom-user>` : '';

        this.threadId = wecomThreadId(channelId, chatid);
        await AgentRunner.run({
            query,
            callbacks: {
                onMessage: this.onAgentMessage.bind(this),
                executeTool: buildExecuteTool(this.threadId, this.executeAgentTool.bind(this)),
            },
            agentId,
            saverId: channel.saver,
            threadId: this.threadId,
            scheduler: { schedulerType: SchedulerType.Channel, schedulerId: String(dbSessionId) },
            extraInfo,
            memoryId,
            workPath,
            agentTools: [createAskAgentTool(ChannelType.Wecom, this.ask.bind(this), [AskQuestionType.Radio, AskQuestionType.Checkbox])],
        });
    }
}
