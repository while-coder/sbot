import { DWClient, EventAck, type DWClientDownStream, type EventAckData } from 'dingtalk-stream';
import {
  IChannelService, ChannelSessionHandler, SessionService,
  type ILogger, type MessageContent,
} from 'channel.base';
import { DingtalkSessionHandler, type DingtalkMessageArgs } from './DingtalkSessionHandler';
import { DingtalkOpenApi } from './DingtalkOpenApi';

const TOPIC_ROBOT = '/v1.0/im/bot/messages/get';
const TITLE_LEN = 12;

/** 会话元数据（仅内存，进程重启后随入站消息自然重建）。OpenAPI 发送只需这些字段。 */
interface SessionEntry {
  conversationId: string;
  conversationType: '1' | '2';   // 1 = 单聊, 2 = 群聊
  senderStaffId: string;          // 群聊时记录最近一次 @机器人 的人
  lastMsgId: string;
  updatedAt: number;
}

/** 入站机器人消息（DingTalk Stream） */
interface RobotIncoming {
  msgtype: string;
  msgId: string;
  text?: { content: string };
  conversationId: string;
  conversationType: '1' | '2';
  senderStaffId: string;
  senderNick: string;
  senderId: string;
  sessionWebhook: string;
  sessionWebhookExpiredTime: number;
  robotCode: string;
  chatbotUserId: string;
  isAdmin: boolean;
  createAt: number;
}

export interface DingtalkServiceOptions {
  clientId: string;
  clientSecret: string;
  logger?: ILogger;
  filterEvent: (eventId: string) => Promise<boolean>;
  onReceiveMessage: (
    userId: string,
    args: DingtalkMessageArgs,
    query: MessageContent,
  ) => Promise<void>;
}

export class DingtalkService implements IChannelService {
  private client: DWClient;
  private logger?: ILogger;
  private opts: DingtalkServiceOptions;
  private openApi: DingtalkOpenApi;
  private sessions = new Map<string, SessionEntry>();

  constructor(options: DingtalkServiceOptions) {
    this.opts = options;
    this.logger = options.logger;
    this.client = new DWClient({
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      keepAlive: true,
      debug: false,
    });
    this.openApi = new DingtalkOpenApi(options.clientId, options.clientSecret, options.logger);
  }

  createSessionHandler(session: SessionService): ChannelSessionHandler {
    return new DingtalkSessionHandler(session, this);
  }

  async sendTextToSession(sessionId: string, text: string): Promise<void> {
    await this.sendMarkdown(sessionId, text);
  }

  async sendTextToUser(userId: string, text: string): Promise<void> {
    // userId 为 senderStaffId；OpenAPI 直接 batchSend 即可，不依赖历史会话
    await this.openApi.sendMarkdownToUser([userId], makeTitle(text), text);
  }

  dispose(): void {
    try { this.client.disconnect(); } catch (_) {}
    this.sessions.clear();
  }

  /** 注册 Stream 监听并连接 */
  async start(): Promise<void> {
    this.client.registerCallbackListener(TOPIC_ROBOT, (msg) => this.handleRobotMessage(msg));
    await this.client.connect();
    this.logger?.info('Dingtalk Stream connected');
  }

  /** 通过 Open API 发送 markdown 消息，群/单聊由 entry 决定 */
  async sendMarkdown(sessionId: string, text: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry) {
      this.logger?.warn(`Dingtalk sendMarkdown: unknown session ${sessionId}`);
      return;
    }
    const title = makeTitle(text);
    try {
      if (entry.conversationType === '2') {
        await this.openApi.sendMarkdownToGroup(entry.conversationId, title, text);
      } else {
        await this.openApi.sendMarkdownToUser([entry.senderStaffId], title, text);
      }
    } catch (e: any) {
      this.logger?.error(`Dingtalk sendMarkdown failed: ${e.message}`);
    }
  }

  /** 处理 IM 机器人消息 */
  private handleRobotMessage(msg: DWClientDownStream): EventAckData {
    let payload: RobotIncoming;
    try {
      payload = JSON.parse(msg.data) as RobotIncoming;
    } catch (e: any) {
      this.logger?.error(`Dingtalk robot message parse failed: ${e.message}`);
      return { status: EventAck.SUCCESS };
    }

    // 同步处理仅做 ACK，实际逻辑放到异步执行
    this.processRobotMessage(payload).catch((e) => {
      this.logger?.error(`Dingtalk processRobotMessage error: ${e.stack || e.message}`);
    });
    return { status: EventAck.SUCCESS };
  }

  private async processRobotMessage(payload: RobotIncoming): Promise<void> {
    if (!await this.opts.filterEvent(`dingtalk_message_${payload.msgId}`)) return;

    const { conversationId, conversationType, senderStaffId, senderNick, msgId } = payload;
    const sessionId = conversationId;

    this.sessions.set(sessionId, {
      conversationId,
      conversationType,
      senderStaffId,
      lastMsgId: msgId,
      updatedAt: Date.now(),
    });

    if (payload.msgtype !== 'text' || !payload.text?.content) {
      this.logger?.warn(`Dingtalk: unsupported msgtype=${payload.msgtype}`);
      return;
    }

    const query = payload.text.content.trim();
    if (!query) return;

    const args: DingtalkMessageArgs = {
      sessionId,
      msgId,
      conversationId,
      conversationType,
      senderStaffId,
      senderNick,
    };
    await this.opts.onReceiveMessage(senderStaffId, args, query);
  }

}

function makeTitle(text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed) return 'AI';
  return trimmed.length > TITLE_LEN ? trimmed.slice(0, TITLE_LEN) + '…' : trimmed;
}
