import { AbstractChatProvider, parseMessages2Text, GlobalLoggerService } from "channel.base";
import type { WechatService } from "./WechatService";

const getLogger = () => GlobalLoggerService.getLogger("WechatChatProvider.ts");

export class WechatChatProvider extends AbstractChatProvider {
  private finished = false;

  constructor(private service: WechatService, private userId: string) {
    super();
  }

  protected async onMessagesUpdated(): Promise<void> {
    // Accumulates messages — sends on finish()
  }

  async finish(): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    const text = parseMessages2Text(this.messages);
    if (!text.trim()) return;
    try {
      await this.service.sendTextMessage(this.userId, text);
    } catch (e: any) {
      getLogger()?.error(`finish error: ${e.message}`, e.stack);
    }
  }
}
