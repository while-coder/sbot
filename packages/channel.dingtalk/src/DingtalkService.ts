import { DWClient, EventAck, type DWClientDownStream, type EventAckData } from 'dingtalk-stream';
import {
  IChannelService, ChannelSessionHandler, SessionService,
  type ILogger, type MessageContent, type PersistedSession,
} from 'channel.base';
import { DingtalkSessionHandler, type DingtalkMessageArgs } from './DingtalkSessionHandler';
import { DingtalkOpenApi } from './DingtalkOpenApi';
import path from 'path';

const TOPIC_ROBOT = '/v1.0/im/bot/messages/get';
const TITLE_LEN = 12;

export enum DingtalkConversationType {
  Single = '1',
  Group = '2',
}

/** 会话元数据（仅内存，进程重启后随入站消息自然重建）。OpenAPI 发送只需这些字段。 */
interface SessionEntry {
  conversationId: string;
  conversationType: DingtalkConversationType;
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
  conversationType: DingtalkConversationType;
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

  /**
   * 用持久化的会话 metadata 重建内存 sessions（重启后无需等入站消息即可主动发送）。
   * metadata 形如 { conversationType, senderStaffId? }；conversationId 即 sessionId。
   */
  hydrateSessions(sessions: PersistedSession[]): void {
    let count = 0;
    for (const { sessionId, metadata } of sessions) {
      const conversationType = metadata?.conversationType as DingtalkConversationType | undefined;
      if (conversationType !== DingtalkConversationType.Group && conversationType !== DingtalkConversationType.Single) continue;
      this.sessions.set(sessionId, {
        conversationId: sessionId,
        conversationType,
        senderStaffId: typeof metadata.senderStaffId === 'string' ? metadata.senderStaffId : '',
        lastMsgId: '',
        updatedAt: 0,
      });
      count++;
    }
    if (count) this.logger?.info(`Dingtalk hydrated ${count} session(s) from store`);
  }

  /** 发送 markdown 消息到会话，群/单聊由 entry 决定 */
  async sendTextToSession(sessionId: string, text: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry) {
      this.logger?.warn(`Dingtalk sendTextToSession: unknown session ${sessionId}`);
      return;
    }
    const title = makeTitle(text);
    try {
      if (entry.conversationType === DingtalkConversationType.Group) {
        await this.openApi.sendMarkdownToGroup(entry.conversationId, title, text);
      } else {
        await this.openApi.sendMarkdownToUser([entry.senderStaffId], title, text);
      }
    } catch (e: any) {
      this.logger?.error(`Dingtalk sendTextToSession failed: ${e.message}`);
    }
  }

  async sendTextToUser(userId: string, text: string): Promise<void> {
    // userId 为 senderStaffId；OpenAPI 直接 batchSend 即可，不依赖历史会话
    await this.openApi.sendMarkdownToUser([userId], makeTitle(text), text);
  }

  /** 发送文件消息到会话，群/单聊由 entry 决定 */
  async sendFileToSession(sessionId: string, file: string | Buffer, fileName?: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry) {
      this.logger?.warn(`Dingtalk sendFileToSession: unknown session ${sessionId}`);
      return;
    }
    const name = resolveFileName(file, fileName);
    const mediaId = await this.openApi.uploadMedia(file, name, 'file');
    const fileType = DingtalkOpenApi.fileTypeOf(name);
    if (entry.conversationType === DingtalkConversationType.Group) {
      await this.openApi.sendFileToGroup(entry.conversationId, mediaId, name, fileType);
    } else {
      await this.openApi.sendFileToUser([entry.senderStaffId], mediaId, name, fileType);
    }
  }

  async sendFileToUser(userId: string, file: string | Buffer, fileName?: string): Promise<void> {
    const name = resolveFileName(file, fileName);
    const mediaId = await this.openApi.uploadMedia(file, name, 'file');
    await this.openApi.sendFileToUser([userId], mediaId, name, DingtalkOpenApi.fileTypeOf(name));
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

function resolveFileName(file: string | Buffer, fileName?: string): string {
  if (fileName) return fileName;
  if (typeof file === 'string') return path.basename(file);
  throw new Error('fileName is required when file is a Buffer');
}

function makeTitle(text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed) return 'AI';
  return trimmed.length > TITLE_LEN ? trimmed.slice(0, TITLE_LEN) + '…' : trimmed;
}
