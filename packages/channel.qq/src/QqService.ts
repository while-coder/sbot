import axios from 'axios';
import WebSocket from 'ws';
import {
  IChannelService, ChannelSessionHandler, SessionService,
  type ILogger, type MessageContent,
} from 'channel.base';
import { QqSessionHandler, type QqMessageArgs } from './QqSessionHandler';

// ── 协议常量 ─────────────────────────────────────────────────────────
const TOKEN_URL = 'https://bots.qq.com/app/getAppAccessToken';
const API_BASE = 'https://api.sgroup.qq.com';

// OP codes
const OP_DISPATCH = 0;
const OP_HEARTBEAT = 1;
const OP_IDENTIFY = 2;
const OP_RESUME = 6;
const OP_RECONNECT = 7;
const OP_INVALID_SESSION = 9;
const OP_HELLO = 10;
const OP_HEARTBEAT_ACK = 11;

// Intents
const INTENT_GUILD_AT_MESSAGE   = 1 << 30;
const INTENT_DIRECT_MESSAGE     = 1 << 12;
const INTENT_GROUP_AND_C2C      = 1 << 25;

const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000, 30000, 60000];

// QQ 平台不允许文本消息中包含 URL（官方 Bot API 限制）
const URL_PATTERN = /https?:\/\/[^\s]+|www\.[^\s]+/gi;

function sanitizeText(text: string): string {
  return text.replace(URL_PATTERN, '[链接已省略]');
}

// ── 类型 ─────────────────────────────────────────────────────────
export interface QqServiceOptions {
  appId: string;
  clientSecret: string;
  /** 群聊回复时是否 @ 发送者，默认 true */
  atSenderOnReply?: boolean;
  /** 沙箱 / 正式：默认 false=正式，true=sandbox */
  sandbox?: boolean;
  logger?: ILogger;
  filterEvent: (eventId: string) => Promise<boolean>;
  onReceiveMessage: (
    userId: string,
    args: QqMessageArgs,
    query: MessageContent,
  ) => Promise<void>;
}

interface SessionEntry {
  /** 'c2c' | 'group' */
  type: 'c2c' | 'group';
  /** C2C: user_openid; Group: group_openid */
  targetId: string;
  /** Group 消息时记录最后一次的 author user_openid */
  authorOpenId?: string;
  /** 用于"被动回复"的最近 msg_id */
  lastMsgId: string;
  /** 累计回复 seq（同一 msg_id 下序号必须自增） */
  msgSeqMap: Map<string, number>;
  lastUpdated: number;
}

/** QQ Bot 网关下发的 IDENTIFY 内 d 字段 */
interface ReadyData {
  user: { id: string; username: string; bot: boolean };
  session_id: string;
  shard?: number[];
}

export class QqService implements IChannelService {
  private opts: QqServiceOptions;
  private logger?: ILogger;
  private sessions = new Map<string, SessionEntry>();

  // token 状态
  private accessToken = '';
  private accessTokenExpire = 0;

  // WS 状态
  private ws: WebSocket | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private heartbeatIntervalMs = 30000;
  private lastSeq: number | null = null;
  private wsSessionId: string | null = null;
  private selfUserId = '';
  private reconnectAttempts = 0;
  private stopping = false;

  constructor(options: QqServiceOptions) {
    this.opts = options;
    this.logger = options.logger;
  }

  createSessionHandler(session: SessionService): ChannelSessionHandler {
    return new QqSessionHandler(session, this);
  }

  async sendTextToSession(sessionId: string, text: string): Promise<void> {
    await this.sendMarkdownOrText(sessionId, text);
  }

  async sendTextToUser(userId: string, text: string): Promise<void> {
    // QQ 官方 Bot API：仅能向最近发过消息的 user_openid 推送
    const entry = this.sessions.get(`c2c:${userId}`);
    if (!entry) {
      this.logger?.warn(`QQ sendTextToUser: no c2c session for ${userId}`);
      return;
    }
    await this.sendMarkdownOrText(`c2c:${userId}`, text);
  }

  dispose(): void {
    this.stopping = true;
    this.clearHeartbeat();
    try { this.ws?.close(); } catch (_) {}
    this.ws = null;
    this.sessions.clear();
  }

  /** 启动：取 token、连接网关 */
  async start(): Promise<void> {
    await this.refreshAccessToken();
    await this.connect();
  }

  // ── 公开发送 API（Handler 用） ─────────────────────────
  async sendMarkdownOrText(sessionId: string, text: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry) {
      this.logger?.warn(`QQ sendMarkdownOrText: unknown session ${sessionId}`);
      return;
    }
    const sanitized = sanitizeText(text);
    const path = entry.type === 'group'
      ? `/v2/groups/${entry.targetId}/messages`
      : `/v2/users/${entry.targetId}/messages`;
    const seq = (entry.msgSeqMap.get(entry.lastMsgId) ?? 0) + 1;
    entry.msgSeqMap.set(entry.lastMsgId, seq);
    const body = {
      content: sanitized,
      msg_type: 0,        // 0 = text
      msg_id: entry.lastMsgId,  // 被动回复
      msg_seq: seq,
    };
    try {
      await this.apiRequest('POST', path, body);
    } catch (e: any) {
      this.logger?.error(`QQ send failed (${path}): ${e.message}`);
    }
  }

  /** Handler 通过此读取 session 信息 */
  getSession(sessionId: string): SessionEntry | undefined {
    return this.sessions.get(sessionId);
  }

  // ── token 管理 ─────────────────────────────────────────
  private async refreshAccessToken(): Promise<void> {
    try {
      const resp = await axios.post(TOKEN_URL, {
        appId: this.opts.appId,
        clientSecret: this.opts.clientSecret,
      }, { timeout: 15000 });
      const token = resp.data?.access_token;
      const expires = Number(resp.data?.expires_in ?? 7200);
      if (!token) throw new Error(`bad token response: ${JSON.stringify(resp.data)}`);
      this.accessToken = token;
      // 提前 5 分钟刷新
      this.accessTokenExpire = Date.now() + Math.max(60_000, (expires - 300) * 1000);
      // 调度下一次刷新
      setTimeout(() => {
        if (!this.stopping) this.refreshAccessToken().catch(e => this.logger?.error(`QQ refresh token error: ${e.message}`));
      }, Math.max(60_000, (expires - 300) * 1000));
    } catch (e: any) {
      this.logger?.error(`QQ getAppAccessToken failed: ${e.message}`);
      throw e;
    }
  }

  private async getValidToken(): Promise<string> {
    if (Date.now() >= this.accessTokenExpire) {
      await this.refreshAccessToken();
    }
    return this.accessToken;
  }

  private async apiRequest(method: 'GET' | 'POST', path: string, body?: any): Promise<any> {
    const token = await this.getValidToken();
    const url = `${API_BASE}${path}`;
    try {
      const resp = await axios.request({
        method, url, data: body,
        headers: {
          Authorization: `QQBot ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      });
      return resp.data;
    } catch (e: any) {
      const status = e.response?.status;
      const data = e.response?.data;
      throw new Error(`QQ API ${path} ${status}: ${JSON.stringify(data)}`);
    }
  }

  // ── WebSocket Gateway ─────────────────────────────────
  private async connect(): Promise<void> {
    let gatewayUrl: string;
    try {
      const data = await this.apiRequest('GET', '/gateway');
      gatewayUrl = data?.url;
    } catch (e: any) {
      this.logger?.error(`QQ get gateway url failed: ${e.message}`);
      this.scheduleReconnect();
      return;
    }
    if (!gatewayUrl) {
      this.logger?.error('QQ gateway url missing');
      this.scheduleReconnect();
      return;
    }

    this.logger?.info(`QQ connecting gateway: ${gatewayUrl}`);
    this.ws = new WebSocket(gatewayUrl);

    this.ws.on('open', () => {
      this.logger?.info('QQ WebSocket opened');
    });

    this.ws.on('message', (raw: WebSocket.RawData) => {
      let pkt: any;
      try { pkt = JSON.parse(raw.toString()); }
      catch (e: any) { this.logger?.error(`QQ ws parse failed: ${e.message}`); return; }
      this.handlePacket(pkt).catch(e => this.logger?.error(`QQ handlePacket error: ${e.stack}`));
    });

    this.ws.on('close', (code, reason) => {
      this.logger?.warn(`QQ ws closed code=${code} reason=${reason?.toString()}`);
      this.clearHeartbeat();
      if (!this.stopping) this.scheduleReconnect();
    });

    this.ws.on('error', (e: any) => {
      this.logger?.error(`QQ ws error: ${e.message}`);
    });
  }

  private async handlePacket(pkt: any): Promise<void> {
    const { op, s, t, d } = pkt;
    if (typeof s === 'number') this.lastSeq = s;

    switch (op) {
      case OP_HELLO: {
        this.heartbeatIntervalMs = d?.heartbeat_interval ?? 30000;
        if (this.wsSessionId && this.lastSeq != null) {
          this.send({ op: OP_RESUME, d: { token: `QQBot ${await this.getValidToken()}`, session_id: this.wsSessionId, seq: this.lastSeq } });
        } else {
          this.send({ op: OP_IDENTIFY, d: {
            token: `QQBot ${await this.getValidToken()}`,
            intents: INTENT_GROUP_AND_C2C | INTENT_GUILD_AT_MESSAGE | INTENT_DIRECT_MESSAGE,
            shard: [0, 1],
            properties: { '$os': process.platform, '$browser': 'sbot', '$device': 'sbot' },
          }});
        }
        this.startHeartbeat();
        return;
      }
      case OP_DISPATCH: {
        if (t === 'READY') {
          const ready = d as ReadyData;
          this.wsSessionId = ready.session_id;
          this.selfUserId = ready.user?.id ?? '';
          this.reconnectAttempts = 0;
          this.logger?.info(`QQ READY user=${ready.user?.username} sessionId=${this.wsSessionId}`);
          return;
        }
        if (t === 'RESUMED') {
          this.reconnectAttempts = 0;
          this.logger?.info('QQ RESUMED');
          return;
        }
        await this.handleDispatch(t, d);
        return;
      }
      case OP_HEARTBEAT_ACK:
        return;
      case OP_RECONNECT:
        this.logger?.warn('QQ asked to reconnect');
        try { this.ws?.close(); } catch (_) {}
        return;
      case OP_INVALID_SESSION:
        this.logger?.warn('QQ invalid session, will re-IDENTIFY');
        this.wsSessionId = null;
        this.lastSeq = null;
        try { this.ws?.close(); } catch (_) {}
        return;
      default:
        this.logger?.debug(`QQ unhandled op=${op}`);
    }
  }

  private async handleDispatch(eventType: string, d: any): Promise<void> {
    const eventId: string = d?.id ?? d?.event_id ?? `${eventType}_${Date.now()}`;
    if (!await this.opts.filterEvent(`qq_${eventId}`)) return;

    if (eventType === 'C2C_MESSAGE_CREATE') {
      const userOpenId = d?.author?.user_openid ?? d?.author?.id ?? '';
      const msgId = d?.id ?? '';
      const text = (d?.content ?? '').trim();
      if (!userOpenId || !msgId || !text) return;
      const sessionId = `c2c:${userOpenId}`;
      this.upsertSession(sessionId, {
        type: 'c2c', targetId: userOpenId, lastMsgId: msgId, authorOpenId: userOpenId,
      });
      const args: QqMessageArgs = {
        sessionId, msgId,
        chatType: 'c2c',
        userOpenId,
        atSenderOnReply: this.opts.atSenderOnReply ?? false,
      };
      await this.opts.onReceiveMessage(userOpenId, args, text);
      return;
    }

    if (eventType === 'GROUP_AT_MESSAGE_CREATE') {
      const groupOpenId = d?.group_openid ?? '';
      const memberOpenId = d?.author?.member_openid ?? d?.author?.id ?? '';
      const msgId = d?.id ?? '';
      const text = (d?.content ?? '').replace(/<@!?\d+>/g, '').trim();
      if (!groupOpenId || !msgId || !text) return;
      const sessionId = `group:${groupOpenId}`;
      this.upsertSession(sessionId, {
        type: 'group', targetId: groupOpenId, lastMsgId: msgId, authorOpenId: memberOpenId,
      });
      const args: QqMessageArgs = {
        sessionId, msgId,
        chatType: 'group',
        groupOpenId,
        userOpenId: memberOpenId,
        atSenderOnReply: this.opts.atSenderOnReply ?? false,
      };
      await this.opts.onReceiveMessage(memberOpenId, args, text);
      return;
    }

    this.logger?.debug(`QQ unhandled event ${eventType}`);
  }

  private upsertSession(sessionId: string, patch: Partial<SessionEntry> & Pick<SessionEntry, 'type' | 'targetId' | 'lastMsgId'>): void {
    const prev = this.sessions.get(sessionId);
    const next: SessionEntry = {
      ...(prev ?? { msgSeqMap: new Map() }),
      ...patch,
      msgSeqMap: prev?.msgSeqMap ?? new Map(),
      lastUpdated: Date.now(),
    };
    this.sessions.set(sessionId, next);
  }

  private send(pkt: any): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    try { this.ws.send(JSON.stringify(pkt)); }
    catch (e: any) { this.logger?.error(`QQ ws send failed: ${e.message}`); }
  }

  private startHeartbeat(): void {
    this.clearHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send({ op: OP_HEARTBEAT, d: this.lastSeq });
    }, this.heartbeatIntervalMs);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.stopping) return;
    const delay = RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempts, RECONNECT_DELAYS_MS.length - 1)];
    this.reconnectAttempts++;
    this.logger?.info(`QQ scheduling reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);
    setTimeout(() => {
      if (this.stopping) return;
      this.connect().catch(e => this.logger?.error(`QQ reconnect failed: ${e.message}`));
    }, delay);
  }
}
