import "reflect-metadata";
import { WecomMessageArgs, WecomUserServiceBase } from "channel.wecom";
import { wecomThreadId, ChannelType } from "sbot.commons";
import { sessionManager } from "channel.base";
import { AskQuestionType } from "scorpio.ai";
import { createAskAgentTool } from "../../Agent/AgentRunner";
import { ChannelMessageMixin } from "./ChannelMessageMixin";

export class WecomUserService extends ChannelMessageMixin(WecomUserServiceBase) {

    protected async onAgentStreamMessage(_message: any): Promise<void> {}

    protected onAbortAction(): void {
        if (this.threadId) sessionManager.abort(this.threadId);
    }

    protected buildThreadId(channelId: string, args: any): string {
        return wecomThreadId(channelId, (args as WecomMessageArgs).chatid);
    }

    protected buildExtraInfo(userInfo: any): string {
        if (!userInfo) return '';
        return `<wecom-user>
  <userid>${userInfo.userid}</userid>
</wecom-user>`;
    }

    protected buildAgentTools(_args: any): any[] {
        return [createAskAgentTool(ChannelType.Wecom, this.ask.bind(this), [AskQuestionType.Radio, AskQuestionType.Checkbox])];
    }
}
