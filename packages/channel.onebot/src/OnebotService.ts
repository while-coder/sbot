import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import {
  IChannelService, ChannelSessionHandler, SessionService,
  readImageAsDataUrl, isEmptyContent,
  type ChannelMessageArgs, type ILogger, type MessageContent,
} from 'channel.base';
import { OnebotSessionHandler } from './OnebotSessionHandler';

export interface OnebotMessageArgs extends ChannelMessageArgs {
  messageType: 'private' | 'group';
  userId: number;
  groupId?: number;
  messageId: number;
  nickname: string;
}

export interface OnebotServiceOptions {
  wsHost: string;
  wsPort: number;
  accessToken?: string;
  requireMention: boolean;
  logger?: ILogger;
  filterEvent: (eventId: string) => Promise<boolean>;
  onReceiveMessage: (userId: string, args: OnebotMessageArgs, query: MessageContent) => Promise<void>;
}

interface PendingCall {
  resolve: (data: any) => void;
  reject: (err: Error) => void;
}

export class OnebotService implements IChannelService {
  private wss: WebSocketServer | null = null;
  private connections = new Set<WebSocket>();
  private pendingCalls = new Map<string, PendingCall>();
  private selfId: string = '';
  private logger?: ILogger;
  private options: OnebotServiceOptions;

  constructor(options: OnebotServiceOptions) {
    this.options = options;
    this.logger = options.logger;
  }

  createSessionHandler(session: SessionService): ChannelSessionHandler {
    return new OnebotSessionHandler(session, this);
  }

  private parseSessionTarget(sessionId: string): { userId?: number; groupId?: number } {
    const parts = sessionId.split(':');
    if (parts[1] === 'group') return { groupId: Number(parts[2]), userId: Number(parts[3]) };
    return { userId: Number(parts[2]) };
  }

  async sendText(sessionId: string, text: string): Promise<void> {
    await this.sendTextMessage(this.parseSessionTarget(sessionId), text);
  }

  async sendFile(_sessionId: string, _file: string | Buffer, _fileName?: string): Promise<void> {}

  async sendNative(_sessionId: string, _payload: any): Promise<void> {}

  dispose() {
    for (const ws of this.connections) {
      try { ws.close(); } catch (_) {}
    }
    this.connections.clear();
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
  }

  start() {
    const { wsHost, wsPort, accessToken } = this.options;
    this.wss = new WebSocketServer({ host: wsHost, port: wsPort });
    this.logger?.info(`OneBot WS server listening on ${wsHost}:${wsPort}`);

    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      if (accessToken && !this.verifyToken(req, accessToken)) {
        this.logger?.warn('OneBot WS connection rejected: invalid token');
        ws.close(4001, 'Unauthorized');
        return;
      }

      this.logger?.info('OneBot WS client connected');
      this.connections.add(ws);

      ws.on('message', (raw: Buffer) => {
        try {
          const data = JSON.parse(raw.toString());
          if (data.echo) {
            this.handleEchoResponse(data);
          } else {
            this.handleEvent(data);
          }
        } catch (e: any) {
          this.logger?.error(`OneBot WS message parse error: ${e.message}`);
        }
      });

      ws.on('close', () => {
        this.connections.delete(ws);
        this.logger?.info('OneBot WS client disconnected');
      });

      ws.on('error', (err) => {
        this.logger?.error(`OneBot WS error: ${err.message}`);
      });
    });

    this.wss.on('error', (err) => {
      this.logger?.error(`OneBot WS server error: ${err.message}`);
    });
  }

  private verifyToken(req: IncomingMessage, token: string): boolean {
    const auth = req.headers['authorization'] ?? '';
    if (auth === `Bearer ${token}` || auth === `Token ${token}`) return true;
    const url = new URL(req.url ?? '', `http://${req.headers.host}`);
    return url.searchParams.get('access_token') === token;
  }

  private handleEchoResponse(data: any) {
    const pending = this.pendingCalls.get(data.echo);
    if (pending) {
      this.pendingCalls.delete(data.echo);
      if (data.retcode === 0) {
        pending.resolve(data.data);
      } else {
        pending.reject(new Error(`OneBot API error: ${data.msg ?? data.wording ?? 'unknown'} (retcode=${data.retcode})`));
      }
    }
  }

  private handleEvent(data: any) {
    if (data.post_type === 'meta_event') {
      this.handleMetaEvent(data);
    } else if (data.post_type === 'message') {
      this.handleMessageEvent(data).catch((e: any) => {
        this.logger?.error(`handleMessageEvent error: ${e.stack}`);
      });
    }
  }

  private handleMetaEvent(data: any) {
    if (data.meta_event_type === 'lifecycle' && data.sub_type === 'connect') {
      this.selfId = String(data.self_id ?? '');
      this.logger?.info(`OneBot connected, self_id=${this.selfId}`);
    }
  }

  private async handleMessageEvent(data: any) {
    const messageType: 'private' | 'group' = data.message_type;
    const userId: number = data.user_id;
    const groupId: number | undefined = data.group_id;
    const messageId: number = data.message_id;
    const nickname: string = data.sender?.card || data.sender?.nickname || String(userId);
    const segments: any[] = Array.isArray(data.message) ? data.message : [];

    if (!await this.options.filterEvent(`onebot_message_${messageId}`)) return;

    // Check @bot mention in group
    if (messageType === 'group' && this.options.requireMention) {
      const mentioned = segments.some(
        seg => seg.type === 'at' && String(seg.data?.qq) === this.selfId
      );
      if (!mentioned) return;
    }

    // Parse segments into content
    const query = await this.parseSegments(segments, messageId);
    if (isEmptyContent(query)) return;

    const sessionId = messageType === 'private'
      ? `onebot:private:${userId}`
      : `onebot:group:${groupId}:${userId}`;

    await this.options.onReceiveMessage(String(userId), {
      sessionId,
      messageType,
      userId,
      groupId,
      messageId,
      nickname,
    }, query);
  }

  private async parseSegments(segments: any[], messageId: number): Promise<MessageContent> {
    const parts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];
    let hasImage = false;

    for (const seg of segments) {
      if (seg.type === 'text' && seg.data?.text) {
        const text = seg.data.text.trim();
        if (text) parts.push({ type: 'text', text });
      } else if (seg.type === 'image' && seg.data?.url) {
        try {
          const filePath = await this.downloadFile(seg.data.url, messageId, '.png');
          const dataUrl = await readImageAsDataUrl(filePath);
          parts.push({ type: 'image_url', image_url: { url: dataUrl } });
          hasImage = true;
        } catch (e: any) {
          this.logger?.error(`Failed to download image: ${e.message}`);
        }
      }
      // at, reply, face, forward etc. are ignored
    }

    if (parts.length === 0) return '';
    if (!hasImage) return parts.map(p => p.text ?? '').join(' ').trim();
    return parts as any;
  }

  private async downloadFile(url: string, messageId: number, ext: string): Promise<string> {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
    const buffer = Buffer.from(await resp.arrayBuffer());
    const filePath = path.join(os.tmpdir(), `onebot_${messageId}_${Date.now()}${ext}`);
    await fs.writeFile(filePath, buffer);
    return filePath;
  }

  // --- Public API methods ---

  async callApi(action: string, params: Record<string, any> = {}): Promise<any> {
    const ws = this.getActiveConnection();
    if (!ws) throw new Error('No active OneBot WebSocket connection');

    const echo = `${action}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const payload = JSON.stringify({ action, params, echo });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCalls.delete(echo);
        reject(new Error(`OneBot API call timeout: ${action}`));
      }, 15_000);

      this.pendingCalls.set(echo, {
        resolve: (data) => { clearTimeout(timer); resolve(data); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      });

      ws.send(payload);
    });
  }

  async sendTextMessage(target: { userId?: number; groupId?: number }, text: string): Promise<void> {
    const message = [{ type: 'text', data: { text } }];
    if (target.groupId) {
      await this.callApi('send_group_msg', { group_id: target.groupId, message });
    } else if (target.userId) {
      await this.callApi('send_private_msg', { user_id: target.userId, message });
    }
  }

  async sendImageMessage(target: { userId?: number; groupId?: number }, fileUrl: string): Promise<void> {
    const message = [{ type: 'image', data: { file: fileUrl } }];
    if (target.groupId) {
      await this.callApi('send_group_msg', { group_id: target.groupId, message });
    } else if (target.userId) {
      await this.callApi('send_private_msg', { user_id: target.userId, message });
    }
  }

  async sendFileMessage(target: { userId?: number; groupId?: number }, filePath: string, fileName: string): Promise<void> {
    if (target.groupId) {
      await this.callApi('upload_group_file', { group_id: target.groupId, file: filePath, name: fileName });
    } else if (target.userId) {
      await this.callApi('upload_private_file', { user_id: target.userId, file: filePath, name: fileName });
    }
  }

  private getActiveConnection(): WebSocket | null {
    for (const ws of this.connections) {
      if (ws.readyState === WebSocket.OPEN) return ws;
    }
    return null;
  }
}
