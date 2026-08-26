import express, { Request } from 'express';
import { listThreadIds, IAgentSaverService, type StoredMessage } from 'scorpio.ai';
import { saverProviderRegistry } from 'scorpio.saver';
import { config } from '../../Core/Config';
import { AgentRunner } from '../../Agent/AgentRunner';
import { SaverPool } from '../../Agent/SaverPool';
import { database, type ChannelSessionRow } from '../../Core/Database';
import { channelDataService } from '../../Session/ChannelDataService';
import { wikiPluginRegistry } from '../../Wiki/WikiPluginRegistry';
import { WEB_CHANNEL_ID } from '@sbot/shared';
import { api, throwBad } from '../../utils';
import type { RouteContext } from './types';

type SaverResolver = (req: Request) => Promise<{ saverId: string; threadId: string }> | { saverId: string; threadId: string };

export class DataRoutes {
    private formatMessages(items: StoredMessage[]) {
        return items.map(({ id, message: { content, role, tool_calls, tool_call_id, name }, createdAt, thinkId, taskId, kind }) => ({
            id,
            message: { role, content, tool_calls, tool_call_id, name },
            createdAt,
            thinkId,
            taskId,
            kind,
        }));
    }

    /** 通过 SaverPool 复用同 dbPath 实例 */
    private async withSaver<T>(saverId: string, threadId: string, fn: (saver: IAgentSaverService) => Promise<T>): Promise<T> {
        const handle = await SaverPool.getInstance().acquire(saverId, threadId);
        try { return await fn(handle.saver); }
        finally { await handle.release(); }
    }

    private async resolveSessionSaver(row: ChannelSessionRow): Promise<{ saverId: string; threadId: string }> {
        const profile = await channelDataService.getProfile(row.profileId);
        if (!profile) throwBad(`Session id=${row.id} has no associated profile`);
        const saverId = profile?.saver || config.getChannel(row.channelId)?.saver;
        if (!saverId) throwBad(`Session id=${row.id} has no saver configured`);
        const threadId = String(profile.id);
        return { saverId: saverId!, threadId };
    }

    private async getSessionRowByPk(id: string): Promise<ChannelSessionRow> {
        const row = await channelDataService.getSession(id);
        if (!row) { const e: any = new Error(`channel_session id=${id} not found`); e.status = 404; throw e; }
        return row;
    }

    private async getWebSessionRowByProfileId(id: string): Promise<ChannelSessionRow> {
        const profileId = Number(id);
        if (!Number.isInteger(profileId) || profileId <= 0) {
            const e: any = new Error(`Invalid profileId "${id}"`); e.status = 400; throw e;
        }
        const row = await database.findOne<ChannelSessionRow>(database.channelSession, { where: { channelId: WEB_CHANNEL_ID, profileId } });
        if (!row) { const e: any = new Error(`Profile "${id}" is not bound to a web session`); e.status = 404; throw e; }
        return row;
    }

    /** 返回 saver 线程的定位信息（saverId/threadId/存储文件路径），供前端查找原始文件 */
    private async getSaverInfo(saverId: string, threadId: string) {
        const saverConfig = config.getSaver(saverId);
        const provider = saverProviderRegistry.get(saverConfig?.type ?? '');
        const storagePath = provider?.fileExtension
            ? config.getSaverDBPath(saverId, threadId, provider.fileExtension)
            : undefined;
        return { saverId, saverType: saverConfig?.type, threadId, storagePath };
    }

    /** 注册 history+thinks+tasks 三件套到给定 basePath 下 */
    private registerSaverThreadRoutes(app: express.Application, basePath: string, resolve: SaverResolver) {
        app.get(`${basePath}/history`, api(async req => {
            const { saverId, threadId } = await resolve(req);
            return this.withSaver(saverId, threadId, async s => this.formatMessages(await s.getAllMessages(true)));
        }));
        app.delete(`${basePath}/history`, api(async req => {
            const { saverId, threadId } = await resolve(req);
            await this.withSaver(saverId, threadId, s => s.clearMessages());
        }));
        app.get(`${basePath}/thinks/:thinkId`, api(async req => {
            const { saverId, threadId } = await resolve(req);
            return this.withSaver(saverId, threadId, async s => this.formatMessages(await s.getThink(req.params.thinkId as string)));
        }));
        app.get(`${basePath}/tasks/:taskId`, api(async req => {
            const { saverId, threadId } = await resolve(req);
            const taskId = req.params.taskId as string;
            const includeAll = req.query.includeAll === '1' || req.query.includeAll === 'true';
            return this.withSaver(saverId, threadId, async s => this.formatMessages(await s.getTaskMessages(taskId, includeAll)));
        }));
    }

    register(app: express.Application, _ctx: RouteContext): void {
        // ── Savers / Threads ──
        app.get('/api/savers/:saverId/threads', api(async req =>
            listThreadIds(config.getSaverDBPath(req.params.saverId as string), ".db", ".json")
        ));

        this.registerSaverThreadRoutes(app, '/api/savers/:saverId/threads/:threadId', req => ({
            saverId: req.params.saverId as string,
            threadId: req.params.threadId as string,
        }));
        app.get('/api/savers/:saverId/threads/:threadId/info', api(async req =>
            this.getSaverInfo(req.params.saverId as string, req.params.threadId as string)
        ));
        // channel_session 的 dbId → saverId/threadId 解析入口；解析后前端统一走上面的 saver 线程接口
        app.get('/api/channel-sessions/:id/saver-info', api(async req => {
            const { saverId, threadId } = await this.resolveSessionSaver(await this.getSessionRowByPk(req.params.id as string));
            return this.getSaverInfo(saverId, threadId);
        }));
        this.registerSaverThreadRoutes(app, '/api/profiles/:profileId', async req =>
            await this.resolveSessionSaver(await this.getWebSessionRowByProfileId(req.params.profileId as string))
        );

        // ── Notes ──
        app.get('/api/notes/:noteName', api(async req => {
            const svc = await AgentRunner.createNoteService(req.params.noteName as string);
            const notes = (await svc.getAllNotes()).map(n => ({
                id: n.id,
                content: n.content,
                createdAt: n.createdAt,
                lastAccessed: n.lastAccessed,
                accessCount: n.accessCount,
            }));
            await svc.dispose();
            return notes;
        }));

        app.post('/api/notes/:noteName/add', api(async req => {
            const { content, autoSplit, chunkSize } = req.body as { content?: string; autoSplit?: boolean; chunkSize?: number };
            if (!content?.trim()) { const e: any = new Error('content is required'); e.status = 400; throw e; }
            const svc = await AgentRunner.createNoteService(req.params.noteName as string);
            const ids = await svc.addNoteDirect(content.trim(), { autoSplit, chunkSize });
            await svc.dispose();
            return { ids };
        }));

        app.put('/api/notes/:noteName/:noteId', api(async req => {
            const { content } = req.body as { content?: string };
            if (!content?.trim()) { const e: any = new Error('content is required'); e.status = 400; throw e; }
            const svc = await AgentRunner.createNoteService(req.params.noteName as string);
            await svc.updateNoteDirect(req.params.noteId as string, content.trim());
            await svc.dispose();
        }));

        app.delete('/api/notes/:noteName/:noteId', api(async req => {
            const svc = await AgentRunner.createNoteService(req.params.noteName as string);
            await svc.deleteNote(req.params.noteId as string);
            await svc.dispose();
        }));

        app.delete('/api/notes/:noteName', api(async req => {
            const svc = await AgentRunner.createNoteService(req.params.noteName as string);
            const count = await svc.clearAll();
            await svc.dispose();
            return { count };
        }));


        // ── Wiki ──
        // 列出已注册的 wiki 数据源插件（type/label/configSchema/readOnly），供后台渲染数据源下拉与配置表单。
        app.get('/api/wiki-plugins', api(async () => {
            return wikiPluginRegistry.list();
        }));

        app.get('/api/wikis/:wikiName', api(async req => {
            const svc = await AgentRunner.createWikiService(req.params.wikiName as string);
            const pages = await svc.getAllPages();
            return pages.map((p: any) => ({
                id: p.id, title: p.title, tags: p.tags,
                source: p.source, version: p.version,
                createdAt: p.createdAt, updatedAt: p.updatedAt,
            }));
        }));

        app.get('/api/wikis/:wikiName/pages/:pageId', api(async req => {
            const svc = await AgentRunner.createWikiService(req.params.wikiName as string);
            const page = await svc.getPage(req.params.pageId as string);
            if (!page) { const e: any = new Error('Page not found'); e.status = 404; throw e; }
            return page;
        }));

        app.post('/api/wikis/:wikiName/pages', api(async req => {
            const { title, content, tags } = req.body as { title?: string; content?: string; tags?: string[] };
            if (!title?.trim() || !content?.trim()) {
                const e: any = new Error('title and content are required'); e.status = 400; throw e;
            }
            const svc = await AgentRunner.createWikiService(req.params.wikiName as string);
            return svc.createPage(title, content, tags);
        }));

        app.put('/api/wikis/:wikiName/pages/:pageId', api(async req => {
            const svc = await AgentRunner.createWikiService(req.params.wikiName as string);
            return svc.updatePage(req.params.pageId as string, req.body);
        }));

        app.delete('/api/wikis/:wikiName/pages/:pageId', api(async req => {
            const svc = await AgentRunner.createWikiService(req.params.wikiName as string);
            await svc.deletePage(req.params.pageId as string);
            return { ok: true };
        }));

        app.get('/api/wikis/:wikiName/search', api(async req => {
            const query = req.query.q as string;
            const limit = parseInt(req.query.limit as string) || 5;
            if (!query?.trim()) { const e: any = new Error('q parameter is required'); e.status = 400; throw e; }
            const svc = await AgentRunner.createWikiService(req.params.wikiName as string);
            return svc.search(query, limit);
        }));
    }
}

export const dataRoutes = new DataRoutes();
