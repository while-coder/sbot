import "reflect-metadata";
import { SlackMessageArgs, SlackUserServiceBase } from "channel.slack";
import { createAskAgentTool } from "../../Agent/AgentRunner";
import { ChannelType } from "sbot.commons";
import { ChannelMessageMixin } from "./ChannelMessageMixin";

export class SlackUserService extends ChannelMessageMixin(SlackUserServiceBase) {
  protected buildExtraInfo(userInfo: any): string {
    if (!userInfo) return '';
    return `<slack-user>
  <id>${userInfo.id}</id>
  <name>${userInfo.real_name ?? userInfo.name ?? ""}</name>
  <email>${userInfo.profile?.email ?? ""}</email>
<\/slack-user>`;
  }

  protected buildAgentTools(_args: any, threadId: string): any[] {
    return [createAskAgentTool(ChannelType.Slack, (params) => this.executeAsk(threadId, params))];
  }
}
