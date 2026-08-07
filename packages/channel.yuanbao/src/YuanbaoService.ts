import path from 'node:path';
import WebSocket from 'ws';
import {
  ChannelSessionHandler, IChannelService, SessionService, isEmptyContent,
  type ILogger, type MessageContent,
} from 'channel.base';
import {
  CMD_AUTH_BIND, CMD_KICKOUT, CMD_PING, CMD_TYPE_PUSH, CMD_TYPE_RESPONSE,
  buildAuthBindMessage, buildPingMessage, buildPushAck, buildSendMessage, buildTypingMessage,
  decodeAuthBindResponse, decodeConn, decodeKickoutMessage, decodePingResponse,
  type YuanbaoMessageElement,
} from './YuanbaoCodec';
import { YuanbaoAPI } from './YuanbaoAPI';
import { YuanbaoSessionHandler, type YuanbaoMessageArgs } from './YuanbaoSessionHandler';

const WS_URL = 'wss://bot-wss.yuanbao.tencent.com/wss/connection';
const RECONNECT_DELAYS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000];
const NO_RECONNECT_CODES = new Set([4012, 4013, 4014, 4018, 4019, 4021]);
const AUTH_FAILED_CODES = new Set([41103, 41104, 41108]);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.opus', '.silk', '.amr']);
const TEXT_CHUNK_LIMIT = 2800;

export interface YuanbaoSessionTarget {
  chatType: 'c2c' | 'group';
  senderId: string;
  targetId: string;
}

export interface YuanbaoServiceOptions {
  appId: string;
  appSecret: string;
  requireMention: boolean;
  acceptBotMessages: boolean;
  logger?: ILogger;
  filterEvent: (eventId: string) => Promise<boolean>;
  onReceiveMessage: (userId: string, args: YuanbaoMessageArgs, query: MessageContent) => Promise<void>;
}

export class YuanbaoService implements IChannelService {
  private readonly options: YuanbaoServiceOptions;
  private readonly logger?: ILogger;
  private readonly api: YuanbaoAPI;
  private readonly sessions = new Map<string, YuanbaoSessionTarget>();
  private readonly seenMessageIds = new Map<string, number>();
  private readonly typingTimers = new Map<string, NodeJS.Timeout>();
  private ws: WebSocket | null = null;
  private connected = false;
  private connecting = false;
  private stopping = false;
  private botId = '';
  private heartbeatIntervalMs = 5_000;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private heartbeatAck = true;
  private heartbeatTimeouts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;

  constructor(options: YuanbaoServiceOptions) {
    this.options = options;
    this.logger = options.logger;
    this.api = new YuanbaoAPI({
      appId: options.appId,
      appSecret: options.appSecret,
      logger: options.logger,
    });
  }

  createSessionHandler(session: SessionService): ChannelSessionHandler {
    return new YuanbaoSessionHandler(session, this);
  }

  restoreSessions(metadata: Record<string, Record<string, any>>): void {
    for (const [sessionId, value] of Object.entries(metadata)) {
      const chatType = value?.chatType;
      if ((chatType === 'c2c' || chatType === 'group') && value?.senderId && value?.targetId) {
        this.sessions.set(sessionId, { chatType, senderId: value.senderId, targetId: value.targetId });
      }
    }
  }

  async start(): Promise<void> {
    try {
      await this.connect();
    } catch (error: any) {
      this.logger?.error(`Yuanbao initial connection failed: ${error?.message ?? error}`);
      this.scheduleReconnect();
    }
  }

  dispose(): void {
    this.stopping = true;
    this.connected = false;
    this.clearHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    for (const timer of this.typingTimers.values()) clearInterval(timer);
    this.typingTimers.clear();
    try { this.ws?.close(); } catch (_) {}
    this.ws = null;
  }

  async sendTextToSession(sessionId: string, text: string): Promise<void> {
    const target = this.sessions.get(sessionId);
    if (!target) throw new Error(`Unknown Yuanbao session: ${sessionId}`);
    for (let offset = 0; offset < text.length; offset += TEXT_CHUNK_LIMIT) {
      await this.sendElements(target, [{ msgType: 'TIMTextElem', msgContent: { text: text.slice(offset, offset + TEXT_CHUNK_LIMIT) } }]);
    }
  }

  async sendTextToUser(userId: string, text: string): Promise<void> {
    const sessionId = `c2c:${userId}`;
    await this.sendTextToSession(sessionId, text);
  }

  async sendFileToSession(sessionId: string, file: string | Buffer, fileName?: string): Promise<void> {
    const target = this.sessions.get(sessionId);
    if (!target) throw new Error(`Unknown Yuanbao session: ${sessionId}`);
    const element = await this.api.uploadMedia(file, fileName);
    await this.sendElements(target, [element]);
  }

  async sendFileToUser(userId: string, file: string | Buffer, fileName?: string): Promise<void> {
    await this.sendFileToSession(`c2c:${userId}`, file, fileName);
  }

  startTyping(sessionId: string): void {
    if (this.typingTimers.has(sessionId)) return;
    const send = () => this.sendTyping(sessionId, 1).catch(error => {
      this.logger?.debug(`Yuanbao typing heartbeat failed: ${error?.message ?? error}`);
    });
    send();
    this.typingTimers.set(sessionId, setInterval(send, 3_000));
  }

  async stopTyping(sessionId: string): Promise<void> {
    const timer = this.typingTimers.get(sessionId);
    if (!timer) return;
    clearInterval(timer);
    this.typingTimers.delete(sessionId);
    await this.sendTyping(sessionId, 2).catch(() => {});
  }

  private async connect(): Promise<void> {
    if (this.connecting || this.stopping) return;
    this.connecting = true;
    this.clearHeartbeat();
    try {
      const token = await this.api.getToken();
      this.botId = token.botId;
      const ws = new WebSocket(WS_URL);
      this.ws = ws;
      await this.waitForOpen(ws);
      const authFrame = await this.waitForAuth(ws, buildAuthBindMessage(token.botId, token.source, token.token));
      const status = Number(authFrame.head.status ?? 0);
      const auth = authFrame.data.length ? decodeAuthBindResponse(authFrame.data) : {};
      const code = Number(auth?.code ?? status);
      if (code !== 0 && code !== 41101) {
        if (AUTH_FAILED_CODES.has(code)) this.api.invalidateToken();
        throw new Error(`AuthBind failed: code=${code}, message=${auth?.message ?? ''}`);
      }

      this.connected = true;
      this.reconnectAttempts = 0;
      this.heartbeatAck = true;
      this.heartbeatTimeouts = 0;
      ws.on('message', raw => this.handleFrame(Buffer.from(raw as any)).catch(error => {
        this.logger?.error(`Yuanbao frame error: ${error?.stack ?? error}`);
      }));
      ws.on('close', (closeCode, reason) => {
        if (this.ws !== ws) return;
        this.connected = false;
        this.clearHeartbeat();
        this.logger?.warn(`Yuanbao WebSocket closed code=${closeCode} reason=${reason.toString()}`);
        if (NO_RECONNECT_CODES.has(closeCode)) this.stopping = true;
        else if (!this.stopping) this.scheduleReconnect();
      });
      ws.on('error', error => this.logger?.error(`Yuanbao WebSocket error: ${error.message}`));
      this.startHeartbeat();
      this.logger?.info(`Yuanbao authenticated as bot=${this.botId}`);
    } catch (error) {
      this.connected = false;
      try { this.ws?.close(); } catch (_) {}
      this.ws = null;
      throw error;
    } finally {
      this.connecting = false;
    }
  }

  private waitForOpen(ws: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('WebSocket connection timeout')), 15_000);
      const finish = (error?: Error) => {
        clearTimeout(timer);
        ws.off('open', onOpen);
        ws.off('error', onError);
        error ? reject(error) : resolve();
      };
      const onOpen = () => finish();
      const onError = (error: Error) => finish(error);
      ws.once('open', onOpen);
      ws.once('error', onError);
    });
  }

  private waitForAuth(ws: WebSocket, request: Buffer): Promise<ReturnType<typeof decodeConn>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('AuthBind response timeout')), 30_000);
      const finish = (error?: Error, value?: ReturnType<typeof decodeConn>) => {
        clearTimeout(timer);
        ws.off('message', onMessage);
        ws.off('close', onClose);
        if (error) reject(error);
        else resolve(value!);
      };
      const onMessage = (raw: WebSocket.RawData) => {
        try {
          const frame = decodeConn(Buffer.from(raw as any));
          if (frame.head.cmd !== CMD_AUTH_BIND) return;
          finish(undefined, frame);
        } catch (error: any) { finish(error); }
      };
      const onClose = (code: number) => finish(new Error(`WebSocket closed during auth (${code})`));
      ws.on('message', onMessage);
      ws.once('close', onClose);
      ws.send(request, error => { if (error) finish(error); });
    });
  }

  private startHeartbeat(): void {
    this.clearHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.connected) return;
      if (!this.heartbeatAck && ++this.heartbeatTimeouts >= 2) {
        this.logger?.error('Yuanbao heartbeat timed out, reconnecting');
        this.ws?.close();
        return;
      }
      if (this.heartbeatAck) this.heartbeatTimeouts = 0;
      this.heartbeatAck = false;
      this.sendRaw(buildPingMessage()).catch(error => this.logger?.error(`Yuanbao ping failed: ${error.message}`));
    }, this.heartbeatIntervalMs);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private scheduleReconnect(): void {
    if (this.stopping || this.reconnectTimer) return;
    const delay = RECONNECT_DELAYS[Math.min(this.reconnectAttempts, RECONNECT_DELAYS.length - 1)];
    this.reconnectAttempts++;
    this.logger?.info(`Yuanbao reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(error => {
        this.logger?.error(`Yuanbao reconnect failed: ${error?.message ?? error}`);
        this.scheduleReconnect();
      });
    }, delay);
  }

  private async handleFrame(raw: Buffer): Promise<void> {
    const frame = decodeConn(raw);
    const { head, data } = frame;
    if (head.cmdType === CMD_TYPE_RESPONSE) {
      if (head.cmd === CMD_PING) {
        this.heartbeatAck = true;
        const response = data.length ? decodePingResponse(data) : {};
        const seconds = Number(response?.heartInterval ?? 0);
        if (seconds > 0 && seconds * 1000 !== this.heartbeatIntervalMs) {
          this.heartbeatIntervalMs = seconds * 1000;
          this.startHeartbeat();
        }
      } else if (head.cmd === CMD_AUTH_BIND && AUTH_FAILED_CODES.has(Number(head.status ?? 0))) {
        this.api.invalidateToken();
        this.ws?.close();
      }
      return;
    }
    if (head.cmdType !== CMD_TYPE_PUSH) return;
    if (head.needAck) await this.sendRaw(buildPushAck(head));
    if (head.cmd === CMD_KICKOUT) {
      const kickout = data.length ? decodeKickoutMessage(data) : {};
      this.logger?.warn(`Yuanbao kicked out: ${kickout?.reason ?? ''}`);
      this.stopping = true;
      this.ws?.close();
      return;
    }
    if (!data.length) return;
    let payload: any;
    try { payload = JSON.parse(data.toString('utf8')); }
    catch { this.logger?.warn(`Yuanbao push ${head.cmd} did not contain JSON`); return; }
    if (!payload?.callback_command) return;
    await this.handleInbound(payload);
  }

  private async handleInbound(raw: any): Promise<void> {
    const inbound = this.normalizeInbound(raw);
    const msgId = String(inbound.msg_id || inbound.msg_key || '');
    if (msgId && this.seenMessageIds.has(msgId)) return;
    if (msgId) {
      this.seenMessageIds.set(msgId, Date.now());
      if (this.seenMessageIds.size > 5_000) {
        const oldest = [...this.seenMessageIds.entries()].sort((a, b) => a[1] - b[1]).slice(0, 2_500);
        for (const [id] of oldest) this.seenMessageIds.delete(id);
      }
    }
    if (msgId && !await this.options.filterEvent(`yuanbao_${msgId}`)) return;
    const senderId = String(inbound.from_account ?? '');
    if (!senderId) return;
    if (!this.options.acceptBotMessages && this.isBotMessage(inbound)) return;
    const isGroup = String(inbound.callback_command).startsWith('Group.');
    const parsed = await this.parseMessageBody(inbound.msg_body ?? []);
    if (isGroup && this.options.requireMention && !parsed.botMentioned) return;

    let parts = parsed.parts;
    const quote = inbound.cloud_custom_data?.quote;
    if (quote && typeof quote === 'object') {
      const type = Number(quote.type ?? 0);
      const labels: Record<number, string> = { 1: 'message', 2: 'image', 3: 'file', 4: 'audio' };
      let label = labels[type] ?? 'message';
      const description = String(quote.desc ?? '').trim();
      if (type === 3 && AUDIO_EXTENSIONS.has(path.extname(description).toLowerCase())) label = 'audio';
      const prefix = description ? `[quoted ${label}: ${description}]` : `[quoted ${label}]`;
      const firstText = parts.find(part => part.type === 'text');
      if (firstText) firstText.text = `${prefix}\n${firstText.text}`;
      else parts.unshift({ type: 'text', text: prefix });
    }
    const query: MessageContent = parts.length === 1 && parts[0].type === 'text'
      ? parts[0].text
      : parts as MessageContent;
    if (isEmptyContent(query)) return;

    const groupCode = isGroup ? String(inbound.group_code ?? '') : undefined;
    if (isGroup && !groupCode) return;
    const chatType = isGroup ? 'group' : 'c2c';
    const targetId = isGroup ? groupCode! : senderId;
    const sessionId = `${chatType}:${targetId}`;
    this.sessions.set(sessionId, { chatType, senderId, targetId });
    await this.options.onReceiveMessage(senderId, {
      sessionId,
      msgId,
      chatType,
      senderId,
      senderName: String(inbound.sender_nickname ?? '') || senderId.slice(-8),
      groupCode,
      groupName: isGroup ? String(inbound.group_name ?? '') : undefined,
    }, query);
  }

  private normalizeInbound(raw: any): any {
    const msgBody = Array.isArray(raw?.msg_body) ? raw.msg_body.map((item: any) => {
      let content = item?.msg_content ?? {};
      if (typeof content === 'string') {
        try { content = JSON.parse(content); }
        catch { content = { text: content }; }
      }
      return { msg_type: item?.msg_type ?? '', msg_content: content && typeof content === 'object' ? content : {} };
    }) : [];
    let custom = raw?.cloud_custom_data ?? {};
    if (typeof custom === 'string') {
      try { custom = custom ? JSON.parse(custom) : {}; }
      catch { custom = {}; }
    }
    return { ...raw, msg_body: msgBody, cloud_custom_data: custom && typeof custom === 'object' ? custom : {} };
  }

  private isBotMessage(inbound: any): boolean {
    if (String(inbound.from_account ?? '').startsWith('bot_')) return true;
    return (inbound.msg_body ?? []).some((item: any) => {
      if (item.msg_type !== 'TIMTextElem' || !item.msg_content?.data) return false;
      try { return JSON.parse(item.msg_content.data)?.elem_type === 1013; }
      catch { return false; }
    });
  }

  private async parseMessageBody(elements: any[]): Promise<{ parts: any[]; botMentioned: boolean }> {
    const parts: any[] = [];
    let botMentioned = false;
    for (const item of elements) {
      const content = item.msg_content ?? {};
      if (item.msg_type === 'TIMCustomElem') {
        try {
          const custom = JSON.parse(content.data ?? '{}');
          if (custom.elem_type === 1002 && custom.user_id === this.botId) botMentioned = true;
        } catch (_) {}
      } else if (item.msg_type === 'TIMTextElem') {
        const text = String(content.text ?? '').replace(`@${this.botId}`, '').trim();
        if (text) parts.push({ type: 'text', text });
      } else if (item.msg_type === 'TIMImageElem') {
        const info = Array.isArray(content.image_info_array) ? content.image_info_array : [];
        const url = String(info.find((entry: any) => entry?.url)?.url ?? content.url ?? '');
        if (url) {
          try {
            const media = await this.api.downloadMedia(url, 'image.jpg');
            parts.push({ type: 'image_url', image_url: { url: `data:${media.mimeType};base64,${media.data.toString('base64')}` } });
          } catch (error: any) {
            this.logger?.warn(`Yuanbao image download failed: ${error?.message ?? error}`);
            parts.push({ type: 'text', text: '[image: download failed]' });
          }
        }
      } else if (item.msg_type === 'TIMFileElem') {
        const url = String(content.url ?? '');
        const fileName = String(content.file_name ?? 'file');
        if (!url) continue;
        if (AUDIO_EXTENSIONS.has(path.extname(fileName).toLowerCase())) {
          try {
            const media = await this.api.downloadMedia(url, fileName);
            parts.push({ type: 'audio', data: media.data.toString('base64'), mimeType: media.mimeType });
          } catch (error: any) {
            this.logger?.warn(`Yuanbao audio download failed: ${error?.message ?? error}`);
            parts.push({ type: 'text', text: '[audio: download failed]' });
          }
        } else {
          parts.push({ type: 'text', text: `[file: ${fileName}]` });
        }
      }
    }
    return { parts, botMentioned };
  }

  private async sendElements(target: YuanbaoSessionTarget, elements: YuanbaoMessageElement[]): Promise<void> {
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Yuanbao WebSocket is not connected');
    }
    await this.sendRaw(buildSendMessage(target.chatType, target.targetId, this.botId, elements));
  }

  private async sendTyping(sessionId: string, heartbeat: 1 | 2): Promise<void> {
    const target = this.sessions.get(sessionId);
    if (!target || !this.connected) return;
    await this.sendRaw(buildTypingMessage(target.chatType, target.targetId, this.botId, target.senderId, heartbeat));
  }

  private sendRaw(data: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Yuanbao WebSocket is not connected'));
        return;
      }
      this.ws.send(data, error => error ? reject(error) : resolve());
    });
  }
}
