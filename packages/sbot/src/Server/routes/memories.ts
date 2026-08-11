import express from 'express';
import { config } from '../../Core/Config';
import { memoryServicePool } from '../../Memory/MemoryServicePool';
import { api, throwBad } from '../../utils';
import type { RouteContext } from './types';
import { MemoryScope } from 'agent.memory';

function requireMemoryId(value: unknown): string {
    if (value == null) throwBad('Missing memoryId');
    const s = String(value).trim();
    if (!s) throwBad('Missing memoryId');
    if (!config.getMemoryProfile(s)) throwBad(`Unknown memoryId: ${s}`);
    return s;
}

function optionalString(value: unknown): string | undefined {
    const raw = Array.isArray(value) ? value[0] : value;
    if (typeof raw !== 'string') return undefined;
    const text = raw.trim();
    return text || undefined;
}

function requireSlug(value: unknown): string {
    const slug = String(value ?? '').trim();
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) throwBad('Missing or invalid memory slug');
    return slug;
}

function requireCommit(value: unknown): string {
    const commit = String(value ?? '').trim();
    if (!/^[0-9a-f]{7,40}$/i.test(commit)) throwBad('Missing or invalid memory history commit');
    return commit;
}

function requireScope(value: unknown, name: string): MemoryScope {
    const raw = Array.isArray(value) ? value[0] : value;
    if (raw === MemoryScope.Global || raw === MemoryScope.Workspace) return raw;
    throwBad(`Missing or invalid ${name}`);
}

type MemoryViewTarget =
    | { scope: MemoryScope.Global }
    | { scope: MemoryScope.Workspace; workPath: string };

function requireViewTarget(scopeValue: unknown, workPathValue: unknown): MemoryViewTarget {
    const scope = requireScope(scopeValue, 'viewScope');
    if (scope === MemoryScope.Global) return { scope };
    const workPath = optionalString(workPathValue);
    if (!workPath) throwBad('Missing workPath for workspace view');
    return { scope, workPath };
}

function acquireMemoryService(memoryId: string, target: MemoryViewTarget) {
    return target.scope === MemoryScope.Workspace
        ? memoryServicePool.acquire(memoryId, target.workPath)
        : memoryServicePool.acquireGlobal(memoryId);
}

export class MemoryRoutes {
    register(app: express.Application, _ctx: RouteContext): void {
        /** 已创建过的工作目录作用域；只读 scope.json，不打开对应数据库。 */
        app.get('/api/memories/:id/scopes', api(async (req) => {
            const memoryId = requireMemoryId(req.params.id);
            return { memoryId, workspaces: memoryServicePool.listWorkspaceScopes(memoryId) };
        }));

        /**
         * 列出该 memoryId 当前的所有 memory 条目（slug + title + 时间戳 + 读次数）。
         * 不返回 body（避免响应过大）；body 走单独的 read 路由 / agent 工具。
         */
        app.get('/api/memories/:id/list', api(async (req) => {
            const memoryId = requireMemoryId(req.params.id);
            const target = requireViewTarget(req.query.viewScope, req.query.workPath);
            const service = acquireMemoryService(memoryId, target);
            try {
                // workspace service 会为 Agent 合并 workspace + global；Admin 的范围选择器
                // 用于检查单个存储范围，因此列表只返回当前明确选择的 scope。
                const rows = (await service.listAll()).filter(row => row.scope === target.scope);
                // body 不返回（避免响应膨胀）；admin UI 单击行后再走 read_memory 取全文
                const summary = rows.map(r => ({
                    slug: r.slug,
                    kind: r.kind,
                    title: r.title,
                    evidenceCount: r.evidenceCount,
                    createdAt: r.createdAt,
                    updatedAt: r.updatedAt,
                    lastReadAt: r.lastReadAt,
                    readCount: r.readCount,
                    scope: r.scope,
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
            const target = requireViewTarget(req.query.viewScope, req.query.workPath);
            const service = acquireMemoryService(memoryId, target);
            try {
                return { memoryId, jobs: service.listPending(limit) };
            } finally {
                service.release();
            }
        }));

        /** 当前全局/工作区范围的本地 Git 历史；slug 可选，用于单条 memory 过滤。 */
        app.get('/api/memories/:id/history', api(async (req) => {
            const memoryId = requireMemoryId(req.params.id);
            const limit = Math.max(1, Math.min(Number(req.query.limit ?? 50) || 50, 200));
            const slug = optionalString(req.query.slug);
            if (slug) requireSlug(slug);
            const target = requireViewTarget(req.query.viewScope, req.query.workPath);
            const service = acquireMemoryService(memoryId, target);
            try {
                return { memoryId, history: service.listHistory(limit, slug) };
            } finally {
                service.release();
            }
        }));

        /** 某次提交在当前范围内的 unified diff。 */
        app.get('/api/memories/:id/history/:commit', api(async (req) => {
            const memoryId = requireMemoryId(req.params.id);
            const commit = requireCommit(req.params.commit);
            const slug = optionalString(req.query.slug);
            if (slug) requireSlug(slug);
            const target = requireViewTarget(req.query.viewScope, req.query.workPath);
            const service = acquireMemoryService(memoryId, target);
            try {
                return { memoryId, history: service.getHistoryDiff(commit, slug) };
            } finally {
                service.release();
            }
        }));

        /** 将单条 memory 恢复到指定 commit 的文件版本，并立即重建该范围索引。 */
        app.post('/api/memories/:id/history/:commit/restore/:slug', api(async (req) => {
            const memoryId = requireMemoryId(req.params.id);
            const commit = requireCommit(req.params.commit);
            const slug = requireSlug(req.params.slug);
            const target = requireViewTarget(req.query.viewScope, req.query.workPath);
            const service = acquireMemoryService(memoryId, target);
            try {
                const row = await service.restoreMemory(commit, slug);
                return { memoryId, commit, slug, row };
            } finally {
                service.release();
            }
        }));

        /** 手动整理：入队合并重复、删除明显冗余、压缩过长 memory 的后台 job。 */
        app.post('/api/memories/:id/consolidate/run', api(async (req) => {
            const memoryId = requireMemoryId(req.params.id);
            const target = requireViewTarget(req.query.viewScope, req.query.workPath);
            const service = acquireMemoryService(memoryId, target);
            try {
                const jobId = service.enqueueConsolidate();
                return { memoryId, jobId };
            } finally {
                service.release();
            }
        }));

        /** 重试一条失败任务：放回 pending 队列并立即唤醒消费。 */
        app.post('/api/memories/:id/jobs/:jobId/retry', api(async (req) => {
            const memoryId = requireMemoryId(req.params.id);
            const jobId = Number(req.params.jobId);
            if (!Number.isSafeInteger(jobId) || jobId <= 0) throwBad('Invalid jobId');
            const target = requireViewTarget(req.query.viewScope, req.query.workPath);
            const service = acquireMemoryService(memoryId, target);
            try {
                if (!service.retryFailedJob(jobId)) {
                    throwBad(`Job #${jobId} is not a failed job in the selected scope`);
                }
                return { memoryId, jobId };
            } finally {
                service.release();
            }
        }));

        /** 删除一条失败任务记录；不允许删除仍在等待或处理中的任务。 */
        app.delete('/api/memories/:id/jobs/:jobId', api(async (req) => {
            const memoryId = requireMemoryId(req.params.id);
            const jobId = Number(req.params.jobId);
            if (!Number.isSafeInteger(jobId) || jobId <= 0) throwBad('Invalid jobId');
            const target = requireViewTarget(req.query.viewScope, req.query.workPath);
            const service = acquireMemoryService(memoryId, target);
            try {
                if (!service.deleteFailedJob(jobId)) {
                    throwBad(`Job #${jobId} is not a failed job in the selected scope`);
                }
                return { memoryId, jobId };
            } finally {
                service.release();
            }
        }));

        /** 单条 memory 全文。 */
        app.get('/api/memories/:id/entries/:slug', api(async (req) => {
            const memoryId = requireMemoryId(req.params.id);
            const slug = requireSlug(req.params.slug);
            const target = requireViewTarget(req.query.viewScope, req.query.workPath);
            const entryScope = requireScope(req.query.entryScope, 'entryScope');
            const service = acquireMemoryService(memoryId, target);
            try {
                const rows = await service.listAll();
                const row = rows.find(r => r.slug === slug && r.scope === entryScope) ?? null;
                if (!row) throwBad(`Memory "${slug}" not found`);
                return { memoryId, slug, row };
            } finally {
                service.release();
            }
        }));

        /** 删除单条 memory：删除 Markdown + DB 行，历史版本由本地 Git 保存。 */
        app.delete('/api/memories/:id/entries/:slug', api(async (req) => {
            const memoryId = requireMemoryId(req.params.id);
            const slug = requireSlug(req.params.slug);
            const target = requireViewTarget(req.query.viewScope, req.query.workPath);
            const entryScope = requireScope(req.query.entryScope, 'entryScope');
            const service = acquireMemoryService(memoryId, target);
            try {
                await service.deleteMemory(slug, entryScope);
                return { memoryId, slug };
            } finally {
                service.release();
            }
        }));

        /**
         * 手动 FS 与 DB 对账。
         * - 用于"手写 / 外部编辑 / 删除 .md 文件"后让索引立即生效
         * - 入队为后台 job，与抽取/整理串行执行，避免并发写 FS/DB
         */
        app.post('/api/memories/:id/reconcile/run', api(async (req) => {
            const memoryId = requireMemoryId(req.params.id);
            const target = requireViewTarget(req.query.viewScope, req.query.workPath);
            const service = acquireMemoryService(memoryId, target);
            try {
                const jobId = service.enqueueReconcile();
                return { memoryId, jobId };
            } finally {
                service.release();
            }
        }));
    }
}

export const memoryRoutes = new MemoryRoutes();
