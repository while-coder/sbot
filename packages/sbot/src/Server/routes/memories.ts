import express from 'express';
import { config } from '../../Core/Config';
import { memoryServicePool } from '../../Memory/MemoryServicePool';
import { api, throwBad } from '../utils';
import type { RouteContext } from './types';

function requireMemoryId(value: unknown): string {
    if (value == null) throwBad('Missing memoryId');
    const s = String(value).trim();
    if (!s) throwBad('Missing memoryId');
    if (!config.getMemoryProfile(s)) throwBad(`Unknown memoryId: ${s}`);
    return s;
}

export class MemoryRoutes {
    register(app: express.Application, _ctx: RouteContext): void {
        /**
         * 强制触发该 memoryId 的一次抽取扫描（绕过 60s tick）。
         * - 立刻扫描所有绑定的 idle session 并抽取
         * - LLM 调用是同步等待——批量 job 可能跑很久
         */
        app.post('/api/memories/:id/extract/run', api(async (req) => {
            const memoryId = requireMemoryId(req.params.id);
            const ran = memoryServicePool.forceExtract(memoryId);
            return { memoryId, ran };
        }));

        /**
         * 列出该 memoryId 当前的所有 memory 条目（slug + title + description + 时间戳 + 读次数）。
         * 不返回 body（避免响应过大）；body 走单独的 read 路由 / agent 工具。
         */
        app.get('/api/memories/:id/list', api(async (req) => {
            const memoryId = requireMemoryId(req.params.id);
            const service = memoryServicePool.get(memoryId);
            if (!service) return { memoryId, memories: [] };
            const rows = await service.listAll();
            // body 不返回（避免响应膨胀）；admin UI 单击行后再走 read_memory 取全文
            const summary = rows.map(r => ({
                slug: r.slug,
                kind: r.kind,
                title: r.title,
                description: r.description,
                evidenceCount: r.evidenceCount,
                createdAt: r.createdAt,
                updatedAt: r.updatedAt,
                lastReadAt: r.lastReadAt,
                readCount: r.readCount,
            }));
            return { memoryId, memories: summary };
        }));

        /** 最近的待处理消息行（pending + failed），用于排查后台抽取是否正常推进。 */
        app.get('/api/memories/:id/extract/jobs', api(async (req) => {
            const memoryId = requireMemoryId(req.params.id);
            const limit = Math.max(1, Math.min(Number(req.query.limit ?? 50) || 50, 200));
            const jobs = memoryServicePool.listPendingMessages(memoryId, limit);
            return { memoryId, jobs };
        }));

        /** 手动整理：合并重复、删除明显冗余、压缩过长 memory。 */
        app.post('/api/memories/:id/consolidate/run', api(async (req) => {
            const memoryId = requireMemoryId(req.params.id);
            const ops = await memoryServicePool.forceConsolidate(memoryId);
            return { memoryId, ops };
        }));

        /** 单条 memory 全文。 */
        app.get('/api/memories/:id/entries/:slug', api(async (req) => {
            const memoryId = requireMemoryId(req.params.id);
            const slug = String(req.params.slug ?? '').trim();
            if (!slug) throwBad('Missing slug');
            const service = memoryServicePool.get(memoryId);
            if (!service) throwBad(`MemoryProfile "${memoryId}" not initialized`);
            const row = (await service.listAll()).find(r => r.slug === slug) ?? null;
            if (!row) throwBad(`Memory "${slug}" not found`);
            return { memoryId, slug, row };
        }));
    }
}

export const memoryRoutes = new MemoryRoutes();
