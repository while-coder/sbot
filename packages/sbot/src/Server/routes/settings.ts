import express from 'express';
import { randomUUID } from 'crypto';
import { ModelProvider, setMaxImageSize } from 'scorpio.ai';
import { config } from '../../Core/Config';
import { database, parseNotes, type ChannelSessionRow } from '../../Core/Database';
import { channelDataService } from '../../Session/ChannelDataService';
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
    register(app: express.Application, ctx: RouteContext): void {
        app.get('/api/settings', api(() => ctx.settingsWithAgents()));

        app.put('/api/settings/general', api(req => {
            const { httpPort, httpUrl, maxImageSize, autoApproveTools, autoApproveAllTools, startupCommands, contextFileNames } = req.body;
            if (httpPort !== undefined) config.settings.httpPort = httpPort || undefined;
            if (httpUrl !== undefined) config.settings.httpUrl = httpUrl || undefined;
            if (maxImageSize !== undefined) {
                config.settings.maxImageSize = maxImageSize || undefined;
                setMaxImageSize(config.settings.maxImageSize);
            }
            if (autoApproveTools !== undefined) config.settings.autoApproveTools = autoApproveTools;
            if (autoApproveAllTools !== undefined) config.settings.autoApproveAllTools = autoApproveAllTools;
            if (startupCommands !== undefined) config.settings.startupCommands = startupCommands;
            if (contextFileNames !== undefined) {
                if (!Array.isArray(contextFileNames)) throwBad('contextFileNames must be an array');
                const cleaned = (contextFileNames as unknown[])
                    .map(s => typeof s === 'string' ? s.trim() : '')
                    .filter(Boolean);
                config.settings.contextFileNames = cleaned.length > 0 ? cleaned : undefined;
            }
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
        settingsCrudHelper.register(app, 'notes', { label: 'Note config', getSettings });
        settingsCrudHelper.register(app, 'wikis', { label: 'Wiki config', getSettings });
        settingsCrudHelper.register(app, 'memoryProfiles', {
            label: 'Memory profile',
            checkOnDelete: true,
            getSettings,
            // 配置变更（writerModel / prompt 等）不强制丢弃缓存实例 —— 那会让同 id 同时跑两个
            // live MemoryService，破坏 store 数据。已 acquire 的实例继续吃旧配置，等 refCount
            // 归零自然 evict，下次 acquire 才拿新配置。
            //
            // 走 beforeDelete 而不是 afterDelete —— markForDeletion 内部 acquire 需要 resolver
            // 仍能解析 profile 配置；afterDelete 时 config 已被删，acquire 会 throw。
            // markForDeletion 已包含 cache miss / hit 两种情况下的 deleteAll 触发，无需 fallback。
            beforeDelete: async (id) => {
                const { memoryServicePool } = await import('../../Memory/MemoryServicePool');
                await memoryServicePool.markForDeletion(id);
            },
        });
        settingsCrudHelper.register(app, 'agendaProfiles', {
            label: 'Agenda profile',
            checkOnDelete: true,
            getSettings,
            afterDelete: async (id) => {
                const { agendaStorePool, agendaTriggerEnginePool } = await import('../../Agenda');
                agendaTriggerEnginePool.remove(id);
                try { await agendaStorePool.get(id).deleteAll(); } catch {}
                agendaStorePool.remove(id);
            },
        });
        // heartbeats 已迁移到独立数据库表，CRUD 在 HeartbeatRoutes 中
        agentRoutes.register(app, ctx);
        acpRoutes.register(app, ctx);
        settingsCrudHelper.register(app, 'channels', {
            label: 'Channel',
            checkOnUpdate: true,
            checkOnDelete: true,
            beforeDelete: (id) => { if (id === WEB_CHANNEL_ID) throwBad('Cannot delete built-in web channel'); },
            afterDelete: async (id) => {
                await channelDataService.deleteChannel(id);
                channelManager.reloadChannel(id);
            },
            afterSave: (id) => channelManager.reloadChannel(id),
            createReturn: (id, body) => ({ id, ...body }),
            getSettings,
        });
        app.get('/api/profiles', api(async () => {
            const rows = await database.findAll<ChannelSessionRow>(database.channelSession, {
                where: { channelId: WEB_CHANNEL_ID },
                order: [['createdAt', 'DESC']],
            });
            const channel = config.getChannel(WEB_CHANNEL_ID);
            const result: any[] = [];
            const seenProfileIds = new Set<number>();
            for (const r of rows) {
                if (seenProfileIds.has(r.profileId)) continue;
                seenProfileIds.add(r.profileId);
                const profile = await channelDataService.getProfile(r.profileId);
                result.push({
                    id: String(r.profileId),
                    profileId: String(r.profileId),
                    name: r.sessionName || r.autoSessionName,
                    createdAt: r.createdAt,
                    agent: profile?.agentId ?? channel?.agent ?? '',
                    saver: profile?.saver ?? channel?.saver ?? '',
                    notes: parseNotes(profile?.notes ?? null),
                    wikis: parseNotes(profile?.wikis ?? null),
                    workPath: profile?.workPath || undefined,
                    autoApproveAllTools: profile?.autoApproveAllTools || undefined,
                    disableWorkspaceContext: profile?.disableWorkspaceContext ?? undefined,
                    disableWorkspaceSkills: profile?.disableWorkspaceSkills ?? undefined,
                    disableWorkspaceMcp: profile?.disableWorkspaceMcp ?? undefined,
                    memory: profile?.memory ?? channel?.memory ?? null,
                    agenda: profile?.agenda ?? channel?.agenda ?? null,
                });
            }
            return result;
        }));

        app.post('/api/settings/profiles', api(async req => {
            const sid = randomUUID();
            const { profile } = await channelDataService.createWebSession(WEB_CHANNEL_ID, sid, req.body);
            return { id: String(profile.id), profileId: String(profile.id) };
        }));

        app.put('/api/settings/profiles/:id', api(async req => {
            const id = req.params.id as string;
            const existing = await channelDataService.getWebSessionByProfileId(id, WEB_CHANNEL_ID);
            if (!existing) throwBad(`Session "${id}" not found`);
            const { profileId } = await channelDataService.updateWebSession(existing!, req.body);
            return { id: String(profileId), profileId: String(profileId) };
        }));

        app.delete('/api/settings/profiles/:id', api(async req => {
            const id = req.params.id as string;
            const existing = await channelDataService.getWebSessionByProfileId(id, WEB_CHANNEL_ID);
            if (!existing) return { success: true };
            await channelDataService.deleteSession(existing.id);
            return { success: true };
        }));
    }
}

export const settingsRoutes = new SettingsRoutes();
