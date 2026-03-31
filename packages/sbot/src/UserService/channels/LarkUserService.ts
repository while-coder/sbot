import "reflect-metadata";
import { LarkMessageArgs, LarkUserServiceBase, LarkReceiveIdType } from "channel.lark";
import { createAskAgentTool, createSendFileAgentTool } from "../../Agent/AgentRunner";
import { ChannelType } from "sbot.commons";
import { AskQuestionType } from "scorpio.ai";
import { ChannelMessageMixin } from "./ChannelMessageMixin";

export class LarkUserService extends ChannelMessageMixin(LarkUserServiceBase) {
    protected buildExtraInfo(userInfo: any): string {
        if (!userInfo) return '';
        return `<lark-user>
  <name>${userInfo.name}</name>
  <email>${userInfo.email}</email>
  <user-id>${userInfo.user_id}</user-id>
  <open-id>${userInfo.open_id}</open-id>
  <union-id>${userInfo.union_id}</union-id>
</lark-user>`;
    }

    protected buildAgentTools(args: any): any[] {
        const { chat_id, larkService } = args as LarkMessageArgs;
        return [
            createAskAgentTool(ChannelType.Lark, (params) => this.executeAsk(params), [AskQuestionType.Radio, AskQuestionType.Checkbox, AskQuestionType.Input]),
            createSendFileAgentTool(ChannelType.Lark, async (filePath, fileName) => {
                await larkService.sendFileMessage(LarkReceiveIdType.ChatId, chat_id, filePath, fileName);
            }),
        ];
    }
}
