import express from 'express';
import { config } from '../../Core/Config';
import { database, getChannelSession, getSessionProfile, getEffectiveSession, type ChannelSessionRow, type SessionProfileRow } from '../../Core/Database';
import { channelManager } from '../../Channel/ChannelManager';
import { schedulerService } from '../../Scheduler/SchedulerService';
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
            const channelId = req.query.channelId as string | undefined;
            const where = channelId ? { channelId } : undefined;
            return await database.findAll(database.channelUser, { where });
        }));

        app.delete('/api/channel-users/:id', api(async req => {
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) { const e: any = new Error('Invalid id'); e.status = 400; throw e; }
            await database.destroy(database.channelUser, { where: { id } });
        }));

        app.get('/api/channel-sessions', api(async req => {
            const channelId = req.query.channelId as string | undefined;
            const where = channelId ? { channelId } : undefined;
            return await database.findAll(database.channelSession, { where });
        }));

        // session 编辑：只接收 sessionName / avatar / profileId；其他配置由 PUT /api/session-profiles/:id 单独修改
        app.put('/api/channel-sessions/:id', api(async req => {
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) throwBad('Invalid id');
            const { sessionName, avatar, profileId } = req.body as Record<string, any>;
            const update: Record<string, any> = {};
            if (sessionName !== undefined) update.sessionName = sessionName;
            if (avatar !== undefined) update.avatar = avatar;
            if (profileId !== undefined) {
                const targetId = Number(profileId);
                if (!targetId || targetId <= 0) throwBad('Invalid profileId');
                const target = await getSessionProfile(targetId);
                if (!target) throwBad(`Profile id=${targetId} not found`);
                if (target.autoForSessionId != null && target.autoForSessionId !== id) {
                    throwBad(`Profile id=${targetId} is auto profile of another session`);
                }
                update.profileId = targetId;
            }
            await database.update(database.channelSession, update, { where: { id } });
        }));

        // 把当前 profile 配置复制成新 visible profile，session.profileId 切到新的
        // 原 auto profile 保留（autoForSessionId 仍指向当前 session）
        app.post('/api/channel-sessions/:id/clone-profile', api(async req => {
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) throwBad('Invalid id');
            const { name } = (req.body ?? {}) as { name?: string };
            const session = await getChannelSession(id, true);
            if (!session) throwBad(`channel_session id=${id} not found`);
            const current = await getSessionProfile(session!.profileId);
            const profileName = (name && name.trim()) || `${session!.sessionName || session!.sessionId}-profile`;
            const created = await database.create<SessionProfileRow>(database.sessionProfile, {
                name: profileName,
                autoForSessionId: null,
                agentId: current?.agentId ?? null,
                saver: current?.saver ?? null,
                memories: current?.memories ?? null,
                wikis: current?.wikis ?? null,
                useChannelMemories: current?.useChannelMemories ?? null,
                useChannelWikis: current?.useChannelWikis ?? null,
                workPath: current?.workPath ?? null,
                streamVerbose: current?.streamVerbose ?? null,
                autoApproveAllTools: current?.autoApproveAllTools ?? null,
                approvalTimeout: current?.approvalTimeout ?? null,
                approvalTimeoutValue: current?.approvalTimeoutValue ?? null,
                askTimeout: current?.askTimeout ?? null,
                askTimeoutMessage: current?.askTimeoutMessage ?? null,
                intentModel: current?.intentModel ?? null,
                intentPrompt: current?.intentPrompt ?? null,
                intentThreshold: current?.intentThreshold ?? null,
                createdAt: Date.now(),
            });
            await database.update(database.channelSession, { profileId: created.id }, { where: { id } });
            return { profileId: created.id };
        }));

        // 切回独立：session.profileId 指回 session 自己的 auto profile（clone-profile 时保留）
        // 若不存在 auto profile（旧数据或异常清理），自动补建一个空 auto profile
        app.post('/api/channel-sessions/:id/detach-profile', api(async req => {
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) throwBad('Invalid id');
            const session = await getChannelSession(id, true);
            if (!session) throwBad(`channel_session id=${id} not found`);
            let auto = await database.findOne<SessionProfileRow>(database.sessionProfile, { where: { autoForSessionId: id } });
            if (!auto) {
                auto = await database.create<SessionProfileRow>(database.sessionProfile, {
                    name: '',
                    autoForSessionId: id,
                    createdAt: Date.now(),
                });
            }
            await database.update(database.channelSession, { profileId: auto.id }, { where: { id } });
            return { profileId: auto.id };
        }));

        app.get('/api/channel-sessions/:id/effective-config', api(async req => {
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) throwBad('Invalid id');
            const eff = await getEffectiveSession(id, true);
            if (!eff) { const e: any = new Error(`channel_session id=${id} not found`); e.status = 404; throw e; }
            return eff;
        }));

        app.delete('/api/channel-sessions/:id', api(async req => {
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) throwBad('Invalid id');
            // auto profile 会被级联删 —— 上面挂的 scheduler 也跟着销毁
            const auto = await database.findOne<SessionProfileRow>(database.sessionProfile, { where: { autoForSessionId: id } });
            if (auto) await schedulerService.cascadeDeleteByProfile(auto.id);
            // 级联删除该 session 的 auto profile（visible profile 不删）
            await database.destroy(database.sessionProfile, { where: { autoForSessionId: id } });
            await database.destroy(database.channelSession, { where: { id } });
        }));

        // ── Session Profiles（仅 visible，autoForSessionId == null） ──
        app.get('/api/session-profiles', api(async () => {
            const profiles = await database.findAll<SessionProfileRow>(database.sessionProfile, { where: { autoForSessionId: null } });
            const result = await Promise.all(profiles.map(async (p: any) => {
                const sessionCount = await database.count(database.channelSession, { where: { profileId: p.id } });
                return { ...p, sessionCount };
            }));
            return result;
        }));

        app.get('/api/session-profiles/:id', api(async req => {
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) throwBad('Invalid id');
            const profile = await getSessionProfile(id);
            if (!profile) { const e: any = new Error(`SessionProfile id=${id} not found`); e.status = 404; throw e; }
            const sessions = await database.findAll<ChannelSessionRow>(database.channelSession, { where: { profileId: id } });
            return { ...profile, sessions };
        }));

        app.post('/api/session-profiles', api(async req => {
            const { name } = req.body as Record<string, any>;
            if (!name) throwBad('name is required');
            const created = await database.create<SessionProfileRow>(database.sessionProfile, {
                name: String(name),
                autoForSessionId: null,
                createdAt: Date.now(),
            });
            return created;
        }));

        app.put('/api/session-profiles/:id', api(async req => {
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) throwBad('Invalid id');
            const b = req.body as Record<string, any>;
            const memSer = b.memories === undefined ? undefined : (b.memories === null ? null : JSON.stringify(b.memories || []));
            const wikiSer = b.wikis === undefined ? undefined : (b.wikis === null ? null : JSON.stringify(b.wikis || []));
            const update: Record<string, any> = {
                name: b.name,
                agentId: b.agentId === undefined ? undefined : (b.agentId || null),
                saver: b.saver === undefined ? undefined : (b.saver || null),
                memories: memSer,
                wikis: wikiSer,
                useChannelMemories: b.useChannelMemories === undefined ? undefined : (b.useChannelMemories === null ? null : !!b.useChannelMemories),
                useChannelWikis: b.useChannelWikis === undefined ? undefined : (b.useChannelWikis === null ? null : !!b.useChannelWikis),
                workPath: b.workPath === undefined ? undefined : (b.workPath || null),
                streamVerbose: b.streamVerbose === undefined ? undefined : (b.streamVerbose ?? null),
                autoApproveAllTools: b.autoApproveAllTools === undefined ? undefined : (b.autoApproveAllTools ?? null),
                approvalTimeout: b.approvalTimeout === undefined ? undefined : (b.approvalTimeout ?? null),
                approvalTimeoutValue: b.approvalTimeoutValue === undefined ? undefined : (b.approvalTimeoutValue ?? null),
                askTimeout: b.askTimeout === undefined ? undefined : (b.askTimeout ?? null),
                askTimeoutMessage: b.askTimeoutMessage === undefined ? undefined : (b.askTimeoutMessage || null),
                intentModel: b.intentModel === undefined ? undefined : (b.intentModel ?? null),
                intentPrompt: b.intentPrompt === undefined ? undefined : (b.intentPrompt || null),
                intentThreshold: b.intentThreshold === undefined ? undefined : (b.intentThreshold ?? null),
            };
            for (const k of Object.keys(update)) if (update[k] === undefined) delete update[k];
            await database.update(database.sessionProfile, update, { where: { id } });
        }));

        app.delete('/api/session-profiles/:id', api(async req => {
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) throwBad('Invalid id');
            const profile = await getSessionProfile(id);
            if (!profile) throwBad(`Profile id=${id} not found`);
            if (profile!.autoForSessionId != null) throwBad('Cannot delete an auto profile directly');
            const refCount = await database.count(database.channelSession, { where: { profileId: id } });
            if (refCount > 0) throwBad(`Profile id=${id} is still referenced by ${refCount} session(s)`);
            await schedulerService.cascadeDeleteByProfile(id);
            await database.destroy(database.sessionProfile, { where: { id } });
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
