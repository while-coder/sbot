import express from 'express';
import { randomUUID } from 'crypto';
import { ModelProvider, setMaxImageSize } from 'scorpio.ai';
import { config } from '../../Core/Config';
import { database, parseMemories, getSessionProfile, ensureChannelSession, type ChannelSessionRow } from '../../Core/Database';
import { heartbeatService } from '../../Heartbeat/HeartbeatService';
import { channelManager } from '../../Channel/ChannelManager';
import { WEB_CHANNEL_ID } from 'sbot.commons';
import { getKnownModels } from '../modelCatalog';
import { modelInfoHelper } from '../helpers/modelInfo';
import { settingsCrudHelper } from '../helpers/settingsCrud';
import { api, throwBad } from '../utils';
import { agentRoutes } from './agents';
import { acpRoutes } from './acp';
import type { RouteContext } from './types';

export class SettingsRoutes {
    private async getWebSessionByProfileId(id: string): Promise<ChannelSessionRow | null> {
        const profileId = Number(id);
        if (!Number.isInteger(profileId) || profileId <= 0) return null;
        return database.findOne<ChannelSessionRow>(database.channelSession, {
            where: { channelId: WEB_CHANNEL_ID, profileId },
        });
    }

    register(app: express.Application, ctx: RouteContext): void {
        app.get('/api/settings', api(() => ctx.settingsWithAgents()));

        app.put('/api/settings/general', api(req => {
            const { httpPort, httpUrl, maxImageSize, autoApproveTools, autoApproveAllTools, startupCommands } = req.body;
            if (httpPort !== undefined) config.settings.httpPort = httpPort || undefined;
            if (httpUrl !== undefined) config.settings.httpUrl = httpUrl || undefined;
            if (maxImageSize !== undefined) {
                config.settings.maxImageSize = maxImageSize || undefined;
                setMaxImageSize(config.settings.maxImageSize);
            }
            if (autoApproveTools !== undefined) config.settings.autoApproveTools = autoApproveTools;
            if (autoApproveAllTools !== undefined) config.settings.autoApproveAllTools = autoApproveAllTools;
            if (startupCommands !== undefined) config.settings.startupCommands = startupCommands;
            config.saveSettings();
            return ctx.settingsWithAgents();
        }));

        // Fetch available models from a provider's baseURL
        app.post('/api/models/available', api(async req => {
            const { baseURL, apiKey, provider, apiVersion } = req.body as { baseURL?: string; apiKey?: string; provider?: string; apiVersion?: string };

            if (provider === ModelProvider.Anthropic) {
                const base = (baseURL || 'https://api.anthropic.com').replace(/\/$/, '');
                if (!apiKey) throwBad('apiKey is required for Anthropic');
                try {
                    const headers: Record<string, string> = {
                        'x-api-key': apiKey,
                        'anthropic-version': '2023-06-01',
                    };
                    const res = await fetch(`${base}/v1/models`, { headers });
                    if (!res.ok) throw new Error(`${res.status}`);
                    const data: any = await res.json();
                    return (data.data || []).map((m: any) => m.id as string);
                } catch {
                    return getKnownModels(ModelProvider.Anthropic);
                }
            }

            if (provider === ModelProvider.Gemini || provider === ModelProvider.GeminiImage) {
                if (!apiKey) throwBad('apiKey is required for Gemini');
                const base = (baseURL || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
                try {
                    const headers: Record<string, string> = { 'x-goog-api-key': apiKey };
                    const ver = apiVersion || 'v1beta';
                    const res = await fetch(`${base}/${ver}/models`, { headers });
                    if (!res.ok) throw new Error(`${res.status}`);
                    const data: any = await res.json();
                    return (data.models || []).map((m: any) => (m.name as string).replace(/^models\//, ''));
                } catch {
                    const imageModels = getKnownModels(ModelProvider.GeminiImage);
                    const textModels = getKnownModels(ModelProvider.Gemini);
                    return provider === ModelProvider.GeminiImage
                        ? [...imageModels, ...textModels]
                        : [...textModels, ...imageModels];
                }
            }

            if (!baseURL) throwBad('baseURL is required');
            const base = baseURL!.replace(/\/$/, '');

            if (provider === ModelProvider.Ollama) {
                const res = await fetch(`${base}/api/tags`);
                if (!res.ok) throwBad(`Ollama request failed: ${res.status}`);
                const data: any = await res.json();
                return (data.models || []).map((m: any) => m.name as string);
            } else {
                // OpenAI-compatible
                const headers: Record<string, string> = { 'Content-Type': 'application/json' };
                if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
                const res = await fetch(`${base}/models`, { headers });
                if (!res.ok) throwBad(`Models request failed: ${res.status}`);
                const data: any = await res.json();
                return (data.data || [])
                    .sort((a: any, b: any) => (b.created ?? 0) - (a.created ?? 0))
                    .map((m: any) => m.id as string);
            }
        }));

        const getSettings = () => ctx.settingsWithAgents();
        settingsCrudHelper.register(app, 'models', {
            label: 'Model',
            afterSave: (id) => modelInfoHelper.fetchAndSaveContextWindow(id).catch(() => {}),
            getSettings,
        });
        settingsCrudHelper.register(app, 'embeddings', { label: 'Embedding', getSettings });
        settingsCrudHelper.register(app, 'savers', { label: 'Saver config', getSettings });
        settingsCrudHelper.register(app, 'memories', { label: 'Memory config', getSettings });
        settingsCrudHelper.register(app, 'wikis', { label: 'Wiki config', getSettings });
        // heartbeats 已迁移到独立数据库表，CRUD 在 HeartbeatRoutes 中
        agentRoutes.register(app, ctx);
        acpRoutes.register(app, ctx);
        settingsCrudHelper.register(app, 'channels', {
            label: 'Channel',
            checkOnUpdate: true,
            checkOnDelete: true,
            beforeDelete: (id) => { if (id === WEB_CHANNEL_ID) throwBad('Cannot delete built-in web channel'); },
            afterDelete: async (id) => {
                const sessions = await database.findAll<ChannelSessionRow>(database.channelSession, { where: { channelId: id } });
                const sessionIds = sessions.map(s => s.id);
                if (sessionIds.length > 0) {
                    await database.destroy(database.heartbeat, { where: { target: sessionIds } });
                }
                await database.destroy(database.channelSession, { where: { channelId: id } });
                await database.destroy(database.channelUser, { where: { channelId: id } });
                await heartbeatService.reloadAll();
                channelManager.reloadChannel(id);
            },
            afterSave: (id) => channelManager.reloadChannel(id),
            createReturn: (id, body) => ({ id, ...body }),
            getSettings,
        });
        app.get('/api/sessions', api(async () => {
            const rows = await database.findAll<ChannelSessionRow>(database.channelSession, {
                where: { channelId: WEB_CHANNEL_ID },
                order: [['createdAt', 'DESC']],
            });
            const result: any[] = [];
            const seenProfileIds = new Set<number>();
            for (const r of rows) {
                if (seenProfileIds.has(r.profileId)) continue;
                seenProfileIds.add(r.profileId);
                const profile = await getSessionProfile(r.profileId);
                result.push({
                    id: String(r.profileId),
                    profileId: String(r.profileId),
                    name: r.sessionName || r.autoSessionName,
                    agent: profile?.agentId || '',
                    saver: profile?.saver || '',
                    memories: parseMemories(profile?.memories ?? null),
                    wikis: parseMemories(profile?.wikis ?? null),
                    workPath: profile?.workPath || undefined,
                    autoApproveAllTools: profile?.autoApproveAllTools || undefined,
                });
            }
            return result;
        }));

        app.post('/api/settings/sessions', api(async req => {
            const body = req.body;
            const sid = randomUUID();
            const { profile } = await ensureChannelSession(WEB_CHANNEL_ID, sid, {
                sessionName: body.name ?? '',
            });
            await database.update(database.sessionProfile, {
                agentId: body.agent || null,
                saver: body.saver || null,
                memories: body.memories ? JSON.stringify(body.memories) : null,
                wikis: body.wikis ? JSON.stringify(body.wikis) : null,
                workPath: body.workPath ?? null,
            }, { where: { id: profile.id } });
            return { id: String(profile.id), profileId: String(profile.id) };
        }));

        app.put('/api/settings/sessions/:id', api(async req => {
            const id = req.params.id as string;
            const existing = await this.getWebSessionByProfileId(id);
            if (!existing) throwBad(`Session "${id}" not found`);
            const body = req.body;
            // sessionName 写 session；其他配置字段写 profile
            if (body.name !== undefined) {
                await database.update(database.channelSession, { sessionName: body.name }, { where: { id: existing!.id } });
            }
            const profile = await getSessionProfile(existing!.profileId);
            if (!profile) throwBad(`Session "${id}" has no associated profile`);
            const profileUpdate: Record<string, any> = {};
            if (body.agent !== undefined) profileUpdate.agentId = body.agent || null;
            if (body.saver !== undefined) profileUpdate.saver = body.saver || null;
            if (body.memories !== undefined) profileUpdate.memories = body.memories ? JSON.stringify(body.memories) : null;
            if (body.wikis !== undefined) profileUpdate.wikis = body.wikis ? JSON.stringify(body.wikis) : null;
            if (body.workPath !== undefined) profileUpdate.workPath = body.workPath;
            if (body.autoApproveAllTools !== undefined) profileUpdate.autoApproveAllTools = !!body.autoApproveAllTools;
            if (Object.keys(profileUpdate).length > 0) {
                await database.update(database.sessionProfile, profileUpdate, { where: { id: profile!.id } });
            }
            return { id: String(profile!.id), profileId: String(profile!.id) };
        }));

        app.delete('/api/settings/sessions/:id', api(async req => {
            const id = req.params.id as string;
            const existing = await this.getWebSessionByProfileId(id);
            if (!existing) return { success: true };
            const profile = await getSessionProfile(existing.profileId);
            await database.destroy(database.channelSession, { where: { id: existing.id } });
            if (profile?.autoForSessionId === existing.id) {
                const refCount = await database.count(database.channelSession, { where: { profileId: profile.id } });
                if (refCount === 0) {
                    await database.destroy(database.sessionProfile, { where: { id: profile.id } });
                }
            }
            return { success: true };
        }));
    }
}

export const settingsRoutes = new SettingsRoutes();
