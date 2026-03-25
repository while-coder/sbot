import "reflect-metadata";
import { SlackMessageArgs, SlackUserServiceBase } from "channel.slack";
import { AgentRunner, createAskAgentTool } from "../Agent/AgentRunner";
import { config } from "../Core/Config";
import { ChannelSessionRow, SchedulerType, database } from "../Core/Database";
import { buildExecuteTool } from "./buildExecuteTool";
import { slackThreadId, ChannelType } from "sbot.commons";

export class SlackUserService extends SlackUserServiceBase {
  async processAIMessage(query: string, args: any): Promise<void> {
    const channelId = args?.channelId as string;
    const channel = channelId ? config.getChannel(channelId) : undefined;
    if (!channel) throw new Error(`Channel "${channelId}" not found`);

    const { channel: slackChannel } = args as SlackMessageArgs;
    const userInfo = args?.userInfo;
    const dbSessionId: number = args?.dbSessionId;
    if (!dbSessionId) throw new Error("dbSessionId not specified");

    const dbSession = await database.findByPk<ChannelSessionRow>(
      database.channelSession,
      dbSessionId,
    );

    const agentId  = dbSession?.agentId  || channel.agent;
    const memoryId = dbSession?.memoryId || channel.memory;

    const extraInfo = userInfo
      ? `<slack-user>
  <id>${userInfo.id}</id>
  <name>${userInfo.real_name ?? userInfo.name ?? ""}</name>
  <email>${userInfo.profile?.email ?? ""}</email>
</slack-user>`
      : '';

    this.threadId = slackThreadId(channelId, slackChannel);
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
      scheduler: { schedulerType: SchedulerType.Channel, schedulerId: String(dbSessionId) },
      extraInfo,
      memoryId,
      agentTools: [createAskAgentTool(ChannelType.Slack, this.ask.bind(this))],
    });
  }
}
