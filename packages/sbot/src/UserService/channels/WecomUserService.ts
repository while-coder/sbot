import "reflect-metadata";
import { WecomMessageArgs, WecomUserServiceBase } from "channel.wecom";
import { ChannelType } from "sbot.commons";
import { AskQuestionType } from "scorpio.ai";
import { createAskAgentTool } from "../../Agent/AgentRunner";
import { ChannelMessageMixin } from "./ChannelMessageMixin";

export class WecomUserService extends ChannelMessageMixin(WecomUserServiceBase) {
    protected buildExtraInfo(userInfo: any): string {
        if (!userInfo) return '';
        return `<wecom-user>
  <userid>${userInfo.userid}</userid>
</wecom-user>`;
    }

    protected buildAgentTools(_args: any): any[] {
        return [createAskAgentTool(ChannelType.Wecom, (params) => this.executeAsk(params), [AskQuestionType.Radio, AskQuestionType.Checkbox])];
    }
}
