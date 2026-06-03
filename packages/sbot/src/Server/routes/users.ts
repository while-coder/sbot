import express from 'express';
import { config } from '../../Core/Config';
import { channelManager } from '../../Channel/ChannelManager';
import { channelDataService } from '../../Session/ChannelDataService';
import { api, throwBad } from '../utils';
import type { RouteContext } from './types';

export class UserRoutes {
    /** 解析 plugin 类型：/api/channel-plugins/:type/... 走 type 参数；/api/channels/:id/... 反查已配置的 channel */
    private resolvePlugin(req: express.Request) {
        if (req.params.type) {
            return { type: req.params.type as string, channel: null };
        }
        const id = req.params.id as string;
        const channel = channelManager.getChannel(id);
        if (!channel) throwBad(`Channel "${id}" not found`);
        return { type: channel!.type, channel };
    }

    private qrCodeHandler() {
        return api(async (req: express.Request) => {
            const { type } = this.resolvePlugin(req);
            const key = req.params.key as string;
            const plugin = channelManager.getPlugin(type);
            if (!plugin?.getQRCode) throwBad(`Plugin "${type}" does not support QR code login`);
            return plugin.getQRCode(key, req.body);
        });
    }

    private qrConfirmHandler() {
        return api(async (req: express.Request) => {
            const { type, channel } = this.resolvePlugin(req);
            const key = req.params.key as string;
            const plugin = channelManager.getPlugin(type);
            if (!plugin?.awaitQRResult) throwBad(`Plugin "${type}" does not support QR code login`);

            const credentials = await plugin.awaitQRResult(key);
            if (!credentials) return { status: "expired" };

            if (channel) {
                const id = req.params.id as string;
                const cfg = channel.config ?? {};
                cfg[key] = credentials;
                channel.config = cfg;
                config.saveSettings();
                await channelManager.reloadChannel(id);
            }

            return { status: "confirmed", credentials };
        });
    }

    register(app: express.Application, _ctx: RouteContext): void {
        app.get('/api/channel-plugins', api(async () => {
            return channelManager.getPluginList();
        }));
        app.get('/api/channel-users', api(async req => {
            return channelDataService.listChannelUsers(req.query.channelId as string | undefined);
        }));

        app.delete('/api/channel-users/:id', api(async req => {
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) throwBad('Invalid id');
            await channelDataService.deleteChannelUser(id);
        }));

        app.get('/api/channel-sessions', api(async req => {
            return channelDataService.listSessions(req.query.channelId as string | undefined);
        }));

        // session 编辑：只接收 sessionName / avatar / profileId；其他配置由 PUT /api/session-profiles/:id 单独修改
        app.put('/api/channel-sessions/:id', api(async req => {
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) throwBad('Invalid id');
            const { sessionName, avatar, profileId } = req.body as Record<string, any>;
            await channelDataService.updateSession(id, { sessionName, avatar, profileId });
        }));

        // 把当前 profile 配置复制成新 visible profile，session.profileId 切到新的
        // 原 auto profile 保留（autoForSessionId 仍指向当前 session）
        app.post('/api/channel-sessions/:id/clone-profile', api(async req => {
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) throwBad('Invalid id');
            const { name } = (req.body ?? {}) as { name?: string };
            return channelDataService.cloneProfileForSession(id, name);
        }));

        // 切回独立：session.profileId 指回 session 自己的 auto profile（clone-profile 时保留）
        app.post('/api/channel-sessions/:id/detach-profile', api(async req => {
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) throwBad('Invalid id');
            return channelDataService.detachToAutoProfile(id);
        }));

        app.get('/api/channel-sessions/:id/effective-config', api(async req => {
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) throwBad('Invalid id');
            const eff = await channelDataService.getEffective(id, true);
            if (!eff) { const e: any = new Error(`channel_session id=${id} not found`); e.status = 404; throw e; }
            return eff;
        }));

        app.delete('/api/channel-sessions/:id', api(async req => {
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) throwBad('Invalid id');
            await channelDataService.deleteSession(id);
        }));

        // ── Session Profiles（仅 visible，autoForSessionId == null） ──
        app.get('/api/session-profiles', api(async () => {
            return channelDataService.listVisibleProfiles();
        }));

        app.get('/api/session-profiles/:id', api(async req => {
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) throwBad('Invalid id');
            const profile = await channelDataService.getVisibleProfileWithSessions(id);
            if (!profile) { const e: any = new Error(`SessionProfile id=${id} not found`); e.status = 404; throw e; }
            return profile;
        }));

        app.post('/api/session-profiles', api(async req => {
            const { name } = req.body as Record<string, any>;
            if (!name) throwBad('name is required');
            return channelDataService.createVisibleProfile(name);
        }));

        app.put('/api/session-profiles/:id', api(async req => {
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) throwBad('Invalid id');
            await channelDataService.updateProfile(id, req.body as Record<string, any>);
        }));

        app.delete('/api/session-profiles/:id', api(async req => {
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) throwBad('Invalid id');
            await channelDataService.deleteVisibleProfile(id);
        }));

        app.post('/api/channels/:channelId/send', api(async req => {
            const channelId = req.params.channelId as string;
            const { sessionId, type, content, payload } = req.body as Record<string, any>;
            if (!sessionId) throwBad('sessionId is required');
            if (!type) throwBad('type is required');
            let ok: boolean;
            switch (type) {
                case 'text':
                    if (!content) throwBad('content is required for type "text"');
                    ok = await channelManager.sendText(channelId, sessionId, content);
                    break;
                case 'file':
                    if (!content) throwBad('content (file path) is required for type "file"');
                    ok = await channelManager.sendFile(channelId, sessionId, content, req.body.fileName);
                    break;
                case 'native':
                    if (!payload) throwBad('payload is required for type "native"');
                    ok = await channelManager.sendNative(channelId, sessionId, payload);
                    break;
                default:
                    throwBad(`Unknown type "${type}", expected "text" | "file" | "native"`);
            }
            if (!ok) throwBad(`Channel "${channelId}" not found or not running`);
        }));

        // --- QR code login ---
        // Supports both /api/channel-plugins/:type/qrcode/:key (add flow)
        // and /api/channels/:id/qrcode/:key (edit flow, auto-persists)
        const qrCodeHandler = this.qrCodeHandler();
        const qrConfirmHandler = this.qrConfirmHandler();
        app.post('/api/channel-plugins/:type/qrcode/:key', qrCodeHandler);
        app.post('/api/channel-plugins/:type/qrcode/:key/confirm', qrConfirmHandler);
        app.post('/api/channels/:id/qrcode/:key', qrCodeHandler);
        app.post('/api/channels/:id/qrcode/:key/confirm', qrConfirmHandler);
    }
}

export const userRoutes = new UserRoutes();
