import "reflect-metadata";
import { SlackMessageArgs, SlackUserServiceBase } from "channel.slack";
import { ICommand } from "scorpio.ai";
import { AgentRunner } from "../Agent/AgentRunner";
import { config } from "../Core/Config";
import { ChannelSessionRow, ContextType, database } from "../Core/Database";
import { buildExecuteTool } from "./buildExecuteTool";
import { slackThreadId } from "sbot.commons";

export class SlackUserService extends SlackUserServiceBase {
  protected async getAllCommands(): Promise<ICommand[]> { return []; }

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

    const schedulerId = `<scheduler-id>${dbSessionId}</scheduler-id>`;
    const extraInfo = userInfo
      ? `${schedulerId}
<current-user>
  <id>${userInfo.id}</id>
  <name>${userInfo.real_name ?? userInfo.name ?? ""}</name>
  <email>${userInfo.profile?.email ?? ""}</email>
</current-user>`
      : schedulerId;

    const threadId = slackThreadId(channelId, slackChannel, args.threadTs ?? args.ts);
    await AgentRunner.run({
      query,
      callbacks: {
        onMessage: this.onAgentMessage.bind(this),
        onStreamMessage: this.onAgentStreamMessage.bind(this),
        executeTool: buildExecuteTool(threadId, this.executeAgentTool.bind(this)),
      },
      agentId,
      saverId: channel.saver,
      threadId,
      contextType: ContextType.Channel,
      extraInfo,
      memoryId,
      askFn: this.ask.bind(this),
    });
  }
}
