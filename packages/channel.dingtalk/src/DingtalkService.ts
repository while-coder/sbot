import axios from 'axios';
import { DWClient, EventAck, type DWClientDownStream, type EventAckData } from 'dingtalk-stream';
import {
  IChannelService, ChannelSessionHandler, SessionService,
  type ILogger, type MessageContent,
} from 'channel.base';
import { DingtalkSessionHandler, type DingtalkMessageArgs, type DingtalkActionArgs } from './DingtalkSessionHandler';

const TOPIC_ROBOT = '/v1.0/im/bot/messages/get';

/** 维护 sessionWebhook 与对话信息（含过期时间） */
interface SessionEntry {
  conversationId: string;
  conversationType: '1' | '2';   // 1 = 单聊, 2 = 群聊
  sessionWebhook: string;
  sessionWebhookExpiredTime: number;
  senderStaffId: string;
  robotCode: string;
  lastMsgId: string;
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
  /** 群聊场景下回复时是否 @ 发送者，默认 false */
  atSenderOnReply?: boolean;
  logger?: ILogger;
  filterEvent: (eventId: string) => Promise<boolean>;
  onReceiveMessage: (
    userId: string,
    args: DingtalkMessageArgs,
    query: MessageContent,
  ) => Promise<void>;
  onTriggerAction: (
    userId: string,
    args: DingtalkActionArgs,
  ) => Promise<void>;
}

export class DingtalkService implements IChannelService {
  private client: DWClient;
  private logger?: ILogger;
  private opts: DingtalkServiceOptions;
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
  }

  createSessionHandler(session: SessionService): ChannelSessionHandler {
    return new DingtalkSessionHandler(session, this);
  }

  async sendTextToSession(sessionId: string, text: string): Promise<void> {
    await this.sendMarkdown(sessionId, text);
  }

  async sendTextToUser(userId: string, text: string): Promise<void> {
    // userId 为 senderStaffId；只能向最近发过消息的私聊用户回写。
    const entry = this.findSessionByStaffId(userId);
    if (!entry) {
      this.logger?.warn(`Dingtalk sendTextToUser: no session for userId=${userId}`);
      return;
    }
    await this.sendMarkdown(entry.conversationId, text);
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

  /** 通过 sessionWebhook 发送 markdown 消息 */
  async sendMarkdown(sessionId: string, text: string, atUsers?: string[]): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry) {
      this.logger?.warn(`Dingtalk sendMarkdown: unknown session ${sessionId}`);
      return;
    }
    if (entry.sessionWebhookExpiredTime && entry.sessionWebhookExpiredTime < Date.now()) {
      this.logger?.warn(`Dingtalk sendMarkdown: sessionWebhook expired for ${sessionId}`);
      return;
    }
    const isGroup = entry.conversationType === '2';
    const at = isGroup && atUsers?.length
      ? { atUserIds: atUsers, isAtAll: false }
      : undefined;
    const payload: any = {
      msgtype: 'markdown',
      markdown: { title: 'AI', text },
      ...(at ? { at } : {}),
    };
    try {
      await axios.post(entry.sessionWebhook, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000,
      });
    } catch (e: any) {
      this.logger?.error(`Dingtalk sendMarkdown failed: ${e.message}`);
    }
  }

  /** 私下与 Handler 共享 session 信息 */
  getSession(sessionId: string): SessionEntry | undefined {
    return this.sessions.get(sessionId);
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

    const { conversationId, conversationType, senderStaffId, senderNick, sessionWebhook, sessionWebhookExpiredTime, robotCode, msgId } = payload;
    const sessionId = conversationId;

    this.sessions.set(sessionId, {
      conversationId,
      conversationType,
      sessionWebhook,
      sessionWebhookExpiredTime,
      senderStaffId,
      robotCode,
      lastMsgId: msgId,
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
      robotCode,
      atSenderOnReply: this.opts.atSenderOnReply ?? false,
    };
    await this.opts.onReceiveMessage(senderStaffId, args, query);
  }

  private findSessionByStaffId(staffId: string): SessionEntry | undefined {
    for (const entry of this.sessions.values()) {
      if (entry.senderStaffId === staffId && entry.conversationType === '1') return entry;
    }
    return undefined;
  }
}
