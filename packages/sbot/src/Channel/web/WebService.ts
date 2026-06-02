import fs from 'fs';
import path from 'path';
import http from 'http';
import { randomUUID } from 'crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { isEmptyContent, resizeImageIfNeeded, type MessageContent } from "scorpio.ai";
import { IChannelService, ChannelSessionHandler, SessionService } from "channel.base";
import { WsCommandType, WEB_CHANNEL_ID, WEB_CHANNEL_TYPE } from 'sbot.commons';
import { database, type ChannelSessionRow } from "../../Core/Database";
import { sessionManager } from "../../Session/SessionManager";
import { LoggerService } from "../../Core/LoggerService";
import { WebSocketSessionHandler } from "./WebSocketSessionHandler";

const logger = LoggerService.getLogger("WebService.ts");

type AttachmentInput = { name: string; dataUrl?: string; content?: string };
type ContentPartInput = { type: 'text'; text: string } | { type: 'image'; dataUrl: string };

function isImageDataUrl(dataUrl: string): boolean {
    return /^data:image\//.test(dataUrl);
}

/**
 * 将编辑器交错的 text/image parts + 附件文件构造为 MessageContent。
 * - parts 保持编辑器顺序
 * - 非内联的文件附件追加在末尾，落盘到 uploadDir 后以 markdown 文件链接的形式插入文本
 */
async function processMessage(parts: ContentPartInput[], attachments: AttachmentInput[] | undefined, uploadDir: string): Promise<MessageContent> {
    const msgParts: Array<{ type: string; text?: string;[key: string]: any }> = [];
    let hasImage = false;

    for (const p of parts) {
        if (p.type === 'text') {
            msgParts.push({ type: 'text', text: p.text });
        } else if (p.type === 'image' && p.dataUrl) {
            const url = await resizeImageIfNeeded(p.dataUrl);
            msgParts.push({ type: 'image_url', image_url: { url } });
            hasImage = true;
        }
    }

    if (attachments?.length) {
        for (const att of attachments) {
            if (att.dataUrl && isImageDataUrl(att.dataUrl)) {
                const url = await resizeImageIfNeeded(att.dataUrl);
                msgParts.push({ type: 'image_url', image_url: { url } });
                hasImage = true;
            } else if (att.dataUrl) {
                const filePath = path.join(uploadDir, `${randomUUID()}-${att.name}`);
                fs.writeFileSync(filePath, Buffer.from(att.dataUrl.replace(/^data:[^;]+;base64,/, ''), 'base64'));
                msgParts.push({ type: 'text', text: `[file: ${att.name}](${filePath})` });
            } else if (att.content != null) {
                const filePath = path.join(uploadDir, `${randomUUID()}-${att.name}`);
                fs.writeFileSync(filePath, att.content);
                msgParts.push({ type: 'text', text: `[file: ${att.name}](${filePath})` });
            }
        }
    }

    if (msgParts.length === 0) return '';
    if (!hasImage) return msgParts.map(p => p.text!).join('\n');
    return msgParts;
}

/**
 * Web channel 的 IChannelService 实现：管理 ws 客户端连接、广播事件、为每个 SbotSession 创建 WebSocketSessionHandler。
 * 由 HttpServer 在创建 http.Server 后调用 attach() 完成 WS 升级路径绑定，并通过 channelManager.registerService 注册。
 */
export class WebService implements IChannelService {
    private readonly wsClients = new Set<WebSocket>();
    private wss?: WebSocketServer;

    private async resolveIncomingSession(msg: Record<string, any>): Promise<{ session: ChannelSessionRow; profileId: string; channelSessionId: string }> {
        const rawProfileId = msg.profileId as string | number | undefined;
        if (rawProfileId === undefined || rawProfileId === null || rawProfileId === '') throw new Error('profileId is required');
        const profileId = Number(rawProfileId);
        if (!Number.isInteger(profileId) || profileId <= 0) throw new Error('Invalid profileId');
        const session = await database.findOne<ChannelSessionRow>(database.channelSession, {
            where: { channelId: WEB_CHANNEL_ID, profileId },
        });
        if (!session) throw new Error(`profileId ${profileId} is not bound to a web session`);
        return { session, profileId: String(session.profileId), channelSessionId: session.sessionId };
    }

    attach(server: http.Server, uploadDir: string): void {
        logger.info(`attach: uploadDir=${uploadDir}`);
        // noServer + manual upgrade routing: with `{ server, path }`, this WSS would
        // also respond 400 to upgrades for paths it doesn't own (e.g. /ws/pty),
        // corrupting the 101 already sent by the other WSS on the same server.
        const wss = this.wss = new WebSocketServer({ noServer: true });
        server.on('upgrade', (req, socket, head) => {
            const pathname = (req.url ?? '').split('?')[0];
            logger.debug(`upgrade: path=${pathname} from=${req.socket.remoteAddress}:${req.socket.remotePort}`);
            if (pathname !== '/ws/chat') return;
            wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
        });
        wss.on('connection', (ws, req: http.IncomingMessage) => {
            this.wsClients.add(ws);
            const peer = `${req?.socket?.remoteAddress}:${req?.socket?.remotePort}`;
            logger.info(`ws connected: peer=${peer} clients=${this.wsClients.size}`);
            ws.on('close', (code, reason) => {
                this.wsClients.delete(ws);
                logger.info(`ws closed: peer=${peer} code=${code} reason=${reason?.toString() || ''} clients=${this.wsClients.size}`);
            });
            ws.on('error', e => logger.warn(`ws socket error: peer=${peer} err=${e?.message ?? e}`));
            ws.on('message', async (data) => {
                try {
                    const raw = data.toString();
                    const msg = JSON.parse(raw) as { type?: string;[key: string]: any };
                    const { session, profileId, channelSessionId } = await this.resolveIncomingSession(msg);
                    logger.debug(`ws recv: type=${msg.type} profileId=${profileId} channelSessionId=${channelSessionId} bytes=${raw.length}`);
                    switch (msg.type) {
                        case WsCommandType.Query: {
                            const partsCount = msg.parts?.length ?? 0;
                            const attCount = msg.attachments?.length ?? 0;
                            const enriched = await processMessage(msg.parts ?? [], msg.attachments, uploadDir);
                            if (isEmptyContent(enriched)) {
                                logger.debug(`ws query empty: profileId=${profileId} parts=${partsCount} attachments=${attCount}`);
                                break;
                            }
                            logger.debug(`ws query dispatch: profileId=${profileId} dbSessionId=${session.id} parts=${partsCount} attachments=${attCount} enrichedType=${typeof enriched === 'string' ? 'text' : 'parts'}`);
                            sessionManager.onReceiveChannelMessage(enriched, {
                                channelType: WEB_CHANNEL_TYPE,
                                channelId: WEB_CHANNEL_ID,
                                dbSessionId: session.id,
                                sessionId: channelSessionId,
                            });
                            break;
                        }
                        case WsCommandType.Approval:
                        case WsCommandType.Ask:
                        case WsCommandType.Abort: {
                            logger.debug(`ws action: type=${msg.type} profileId=${profileId} dbSessionId=${session.id}`);
                            sessionManager.onTriggerChannelAction(session.id, msg.type!, msg).catch(e => logger.error(`ws trigger error: ${e?.message ?? e}`));
                            break;
                        }
                        default:
                            logger.warn(`ws recv: unknown type=${msg.type} profileId=${profileId}`);
                    }
                } catch (e: any) {
                    logger.error(`ws message error: ${e?.message ?? e}`);
                }
            });
        });
    }

    broadcast(data: string): void {
        let sent = 0;
        for (const ws of this.wsClients) {
            if (ws.readyState === WebSocket.OPEN) { ws.send(data); sent++; }
        }
        logger.debug(`broadcast: sent=${sent}/${this.wsClients.size} bytes=${data.length}`);
    }

    // ── IChannelService ──

    createSessionHandler(session: SessionService): ChannelSessionHandler {
        return new WebSocketSessionHandler(session);
    }

    async sendText(_sessionId: string, _text: string): Promise<void> {
        // Web channel 没有"原文直发"路径，输出统一通过 WebSocketSessionHandler 经 ws 广播给前端。
    }

    async sendFile(_sessionId: string, _file: string | Buffer, _fileName?: string): Promise<void> {
        // 同上：web 没有独立的文件直发通道。
    }

    async sendNative(_sessionId: string, _payload: any): Promise<void> {
        // 同上。
    }

    dispose(): void {
        logger.info(`dispose: closing ${this.wsClients.size} clients`);
        for (const ws of this.wsClients) {
            try { ws.close(); } catch (_) { /* ignore */ }
        }
        this.wsClients.clear();
        try { this.wss?.close(); } catch (_) { /* ignore */ }
        this.wss = undefined;
    }
}

export const webService = new WebService();
