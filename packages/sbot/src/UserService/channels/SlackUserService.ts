import "reflect-metadata";
import { SlackMessageArgs, SlackUserServiceBase } from "channel.slack";
import { createAskAgentTool } from "../../Agent/AgentRunner";
import { slackThreadId, ChannelType } from "sbot.commons";
import { ChannelMessageMixin } from "./ChannelMessageMixin";

export class SlackUserService extends ChannelMessageMixin(SlackUserServiceBase) {
  protected buildThreadId(channelId: string, args: any): string {
    return slackThreadId(channelId, (args as SlackMessageArgs).channel);
  }

  protected buildExtraInfo(userInfo: any): string {
    if (!userInfo) return '';
    return `<slack-user>
  <id>${userInfo.id}</id>
  <name>${userInfo.real_name ?? userInfo.name ?? ""}</name>
  <email>${userInfo.profile?.email ?? ""}</email>
<\/slack-user>`;
  }

  protected buildAgentTools(_args: any): any[] {
    return [createAskAgentTool(ChannelType.Slack, this.ask.bind(this))];
  }
}
