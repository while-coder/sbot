import express from 'express';
import {
    AgendaCategory,
    AgendaListView,
    AgendaPriority,
    AgendaService,
    AgendaStatus,
    type IAgendaService,
    type AgendaListFilter,
    type AgendaCompleteResult,
    type AgendaRecord,
} from 'scorpio.ai';
import { agendaServicePool, agendaStorePool } from '../../Agenda';
import { config } from '../../Core/Config';
import { api, throwBad } from '../utils';
import type { RouteContext } from './types';

function num(v: unknown): number | undefined {
    if (v == null || v === '') return undefined;
    const n = Number(v);
    return Number.isInteger(n) ? n : undefined;
}

function requireAgendaId(value: unknown): string {
    if (value == null) throwBad('Missing agendaId');
    const s = String(value).trim();
    if (!s) throwBad('Missing agendaId');
    if (!config.getAgendaProfile(s)) throwBad(`Unknown agendaId: ${s}`);
    return s;
}

/**
 * 包一层 acquire / release，管理员路径每次调用单独配对，避免 service 长生命周期持有。
 * 与 AgentRunner 共享同一 pool 单例 —— 同 agendaId 下两个调用方拿到的是同一个 service。
 */
async function withAgendaService<T>(agendaId: string, fn: (service: IAgendaService) => Promise<T> | T): Promise<T> {
    const service = agendaServicePool.acquire(agendaId);
    if (!service) throwBad(`Agenda profile "${agendaId}" not enabled`);
    try {
        return await fn(service);
    } finally {
        service.release();
    }
}

export class AgendaRoutes {
    register(app: express.Application, _ctx: RouteContext): void {
        // 列出某个 agenda 模板下的所有 items；不传 agendaId 则跨所有模板聚合
        // 返回项里附 agendaId，便于前端按模板分组/操作
        app.get('/api/agendas', api(async req => {
            const filter = this.parseFilter(req.query);
            const agendaIdRaw = req.query.agendaId;
            if (agendaIdRaw != null && String(agendaIdRaw).trim()) {
                const agendaId = requireAgendaId(agendaIdRaw);
                return withAgendaService(agendaId, async service => {
                    const items = await service.list(filter);
                    return items.map(item => ({ ...item, agendaId }));
                });
            }
            const all = await agendaStorePool.listItemsAcross(agendaStorePool.listAllAgendaIds());
            const grouped = new Map<string, typeof all[number]['record'][]>();
            for (const { agendaId, record } of all) {
                if (!grouped.has(agendaId)) grouped.set(agendaId, []);
                grouped.get(agendaId)!.push(record);
            }
            const items: any[] = [];
            for (const [agendaId, records] of grouped) {
                for (const item of AgendaService.buildList(records, filter)) {
                    items.push({ ...item, agendaId });
                }
            }
            return items;
        }));

        app.post('/api/agendas', api(async req => {
            const body = req.body || {};
            const agendaId = requireAgendaId(body.agendaId);
            const channelSessionId = num(body.channelSessionId) ?? 0;
            return withAgendaService(agendaId, service => service.create({
                content: String(body.content ?? ''),
                category: body.category,
                priority: body.priority,
                trigger: body.trigger,
                triggers: body.triggers,
                dueAt: body.dueAt,
                action: body.action,
                message: body.message,
                completionMode: body.completionMode,
                channelSessionId,
            }));
        }));

        app.patch('/api/agendas/:id', api(async req => {
            const id = Number(req.params.id);
            if (!Number.isInteger(id) || id <= 0) throwBad('Invalid id');
            const agendaId = requireAgendaId(req.body?.agendaId ?? req.query.agendaId);
            const channelSessionId = num(req.body?.channelSessionId) ?? 0;
            return withAgendaService(agendaId, async service => {
                const updated = await service.update(id, { ...(req.body || {}), channelSessionId });
                if (!updated) throwBad('Agenda item not found');
                return updated;
            });
        }));

        app.post('/api/agendas/:id/complete', api(req => this.applyItemAction(req, 'complete')));
        app.post('/api/agendas/:id/cancel', api(req => this.applyItemAction(req, 'cancel')));

        app.delete('/api/agendas/:id', api(async req => {
            const id = Number(req.params.id);
            if (!Number.isInteger(id) || id <= 0) throwBad('Invalid id');
            const agendaId = requireAgendaId(req.body?.agendaId ?? req.query.agendaId);
            return withAgendaService(agendaId, async service => {
                const deleted = await service.delete(id);
                if (!deleted) throwBad('Agenda item not found');
                return { id };
            });
        }));
    }

    private parseFilter(query: any): AgendaListFilter {
        const status = this.parseStatus(query.status);
        const filter: AgendaListFilter = { status };
        if (query.category && Object.values(AgendaCategory).includes(query.category)) filter.category = query.category as AgendaCategory;
        if (query.priority && Object.values(AgendaPriority).includes(query.priority)) filter.priority = query.priority as AgendaPriority;
        if (query.view && Object.values(AgendaListView).includes(query.view)) filter.view = query.view as AgendaListView;
        const limit = num(query.limit);
        if (limit) filter.limit = limit;
        return filter;
    }

    private parseStatus(value: any): AgendaListFilter['status'] {
        if (value && [...Object.values(AgendaStatus), 'all'].includes(value)) return value as AgendaListFilter['status'];
        return 'all';
    }

    private async applyItemAction(req: express.Request, action: 'complete' | 'cancel') {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) throwBad('Invalid id');
        const agendaId = requireAgendaId(req.body?.agendaId ?? req.query.agendaId);
        return withAgendaService<AgendaCompleteResult | AgendaRecord | null>(agendaId, service => {
            if (action === 'complete') {
                const at = typeof req.body?.at === 'string' && req.body.at.trim() ? req.body.at.trim() : undefined;
                return service.complete(id, at);
            }
            return service.cancel(id);
        });
    }
}

export const agendaRoutes = new AgendaRoutes();
