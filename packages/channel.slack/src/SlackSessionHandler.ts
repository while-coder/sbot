import { SlackChatProvider } from "./SlackChatProvider";
import { SlackService } from "./SlackService";
import {
  ChannelSessionHandler, SessionService,
  type ChannelMessageArgs, type MessageType, type MessageContent,
} from "channel.base";

export interface SlackMessageArgs extends ChannelMessageArgs {
  eventId: string;
  ts: string;
  threadTs?: string;
}

export class SlackSessionHandler extends ChannelSessionHandler<SlackChatProvider> {
  constructor(session: SessionService, private slackService: SlackService) {
    super(session);
  }

  async onProcessStart(query: MessageContent, args: ChannelMessageArgs, _messageType: MessageType): Promise<void> {
    const { sessionId, ts, threadTs } = args as SlackMessageArgs;
    this.provider = await new SlackChatProvider(this.slackService).init(sessionId, ts, threadTs);
  }

  async onProcessEnd(_query: MessageContent, _args: ChannelMessageArgs, _messageType: MessageType, error?: any): Promise<void> {
    if (error) {
      this.provider?.setMessage(`Error generating reply: ${error.message}`);
    }
  }
}
