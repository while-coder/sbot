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
         * 强制唤醒该 memoryId 的 pending job 队列。
         * - 对话结束的抽取已经先入队；这里仅负责立即唤醒消费
         * - LLM 调用在后台串行执行，接口立刻返回
         */
        app.post('/api/memories/:id/extract/run', api(async (req) => {
            const memoryId = requireMemoryId(req.params.id);
            await memoryServicePool.forceExtract(memoryId);
            return { memoryId };
        }));

        /**
         * 列出该 memoryId 当前的所有 memory 条目（slug + title + description + 时间戳 + 读次数）。
         * 不返回 body（避免响应过大）；body 走单独的 read 路由 / agent 工具。
         */
        app.get('/api/memories/:id/list', api(async (req) => {
            const memoryId = requireMemoryId(req.params.id);
            const service = await memoryServicePool.acquire(memoryId);
            try {
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
            } finally {
                service.release();
            }
        }));

        /** 最近的待处理 job（pending + failed），用于排查后台抽取/整理是否正常推进。 */
        app.get('/api/memories/:id/jobs', api(async (req) => {
            const memoryId = requireMemoryId(req.params.id);
            const limit = Math.max(1, Math.min(Number(req.query.limit ?? 50) || 50, 200));
            const jobs = await memoryServicePool.listPendingJobs(memoryId, limit);
            return { memoryId, jobs };
        }));

        /** 手动整理：入队合并重复、删除明显冗余、压缩过长 memory 的后台 job。 */
        app.post('/api/memories/:id/consolidate/run', api(async (req) => {
            const memoryId = requireMemoryId(req.params.id);
            const jobId = await memoryServicePool.forceConsolidate(memoryId);
            return { memoryId, jobId };
        }));

        /** 单条 memory 全文。 */
        app.get('/api/memories/:id/entries/:slug', api(async (req) => {
            const memoryId = requireMemoryId(req.params.id);
            const slug = String(req.params.slug ?? '').trim();
            if (!slug) throwBad('Missing slug');
            const service = await memoryServicePool.acquire(memoryId);
            try {
                const row = (await service.listAll()).find(r => r.slug === slug) ?? null;
                if (!row) throwBad(`Memory "${slug}" not found`);
                return { memoryId, slug, row };
            } finally {
                service.release();
            }
        }));

        /** 软删除单条 memory：文件移到 .archive/，DB 行 DELETE。 */
        app.delete('/api/memories/:id/entries/:slug', api(async (req) => {
            const memoryId = requireMemoryId(req.params.id);
            const slug = String(req.params.slug ?? '').trim();
            if (!slug) throwBad('Missing slug');
            const service = await memoryServicePool.acquire(memoryId);
            try {
                const archive = await service.deleteMemory(slug);
                return { memoryId, slug, archive };
            } finally {
                service.release();
            }
        }));

        /**
         * 手动 FS 与 DB 对账。
         * - 用于"手写 / 外部编辑 / 删除 .md 文件"后让索引立即生效
         * - 平时只在 service 首次 build 时跑一次，活着的 service 不会自动对账
         */
        app.post('/api/memories/:id/reconcile/run', api(async (req) => {
            const memoryId = requireMemoryId(req.params.id);
            const service = await memoryServicePool.acquire(memoryId);
            try {
                const stats = await service.reconcile();
                return { memoryId, ...stats };
            } finally {
                service.release();
            }
        }));
    }
}

export const memoryRoutes = new MemoryRoutes();
