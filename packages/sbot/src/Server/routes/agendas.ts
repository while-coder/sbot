import express from 'express';
import {
    AgendaCategory,
    AgendaListView,
    AgendaPriority,
    AgendaService,
    AgendaStatus,
    IAgendaTriggerEngine,
    IAgendaStore,
    ILoggerService,
    ServiceContainer,
    T_AgendaChannelSessionId,
    T_AgendaToolDescs,
    type AgendaListFilter,
    type AgendaToolDescs,
} from 'scorpio.ai';
import { agendaStorePool, agendaTriggerEnginePool } from '../../Agenda';
import { LoggerService } from '../../Core/LoggerService';
import { config } from '../../Core/Config';
import { api, throwBad } from '../utils';
import type { RouteContext } from './types';

const ADMIN_DESCS: AgendaToolDescs = {
    create: 'Create agenda item from admin API',
    list: 'List agenda items from admin API',
    update: 'Update agenda item from admin API',
    complete: 'Complete agenda item from admin API',
    cancel: 'Cancel agenda item from admin API',
};

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

export class AgendaRoutes {
    register(app: express.Application, _ctx: RouteContext): void {
        // 列出某个 agenda 模板下的所有 items；不传 agendaId 则跨所有模板聚合
        // 返回项里附 agendaId，便于前端按模板分组/操作
        app.get('/api/agendas', api(async req => {
            const filter = this.parseFilter(req.query);
            const agendaIdRaw = req.query.agendaId;
            if (agendaIdRaw != null && String(agendaIdRaw).trim()) {
                const agendaId = requireAgendaId(agendaIdRaw);
                const service = await this.createService(agendaId, 0);
                const items = await service.list(filter);
                return items.map(item => ({ ...item, agendaId }));
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
            const service = await this.createService(agendaId, channelSessionId);
            return service.create({
                content: String(body.content ?? ''),
                category: body.category,
                priority: body.priority,
                trigger: body.trigger,
                dueAt: body.dueAt,
                timezone: body.timezone,
                action: body.action,
                message: body.message,
                completionMode: body.completionMode,
            });
        }));

        app.patch('/api/agendas/:id', api(async req => {
            const id = Number(req.params.id);
            if (!Number.isInteger(id) || id <= 0) throwBad('Invalid id');
            const agendaId = requireAgendaId(req.body?.agendaId ?? req.query.agendaId);
            const service = await this.createService(agendaId, 0);
            const updated = await service.update(id, req.body || {});
            if (!updated) throwBad('Agenda item not found');
            return updated;
        }));

        app.post('/api/agendas/:id/complete', api(req => this.applyItemAction(req, 'complete')));
        app.post('/api/agendas/:id/cancel', api(req => this.applyItemAction(req, 'cancel')));

        app.delete('/api/agendas/:id', api(async req => {
            const id = Number(req.params.id);
            if (!Number.isInteger(id) || id <= 0) throwBad('Invalid id');
            const agendaId = requireAgendaId(req.body?.agendaId ?? req.query.agendaId);
            const store = agendaStorePool.get(agendaId);
            const deleted = await store.deleteItem(id);
            if (!deleted) throwBad('Agenda item not found');
            const engine = agendaTriggerEnginePool.get(agendaId);
            for (const trigger of deleted.triggers) engine.cancel(trigger.id);
            return { id };
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
        const service = await this.createService(agendaId, 0);
        if (action === 'complete') {
            const at = typeof req.body?.at === 'string' && req.body.at.trim() ? req.body.at.trim() : undefined;
            return service.complete(id, at);
        }
        return service.cancel(id);
    }

    private async createService(agendaId: string, channelSessionId: number): Promise<AgendaService> {
        const container = new ServiceContainer();
        container.registerInstance(ILoggerService, { getLogger: (name: string) => LoggerService.getLogger(name) });
        container.registerWithArgs(AgendaService, {
            [T_AgendaChannelSessionId]: channelSessionId,
            [T_AgendaToolDescs]: ADMIN_DESCS,
            [IAgendaStore]: agendaStorePool.get(agendaId),
            [IAgendaTriggerEngine]: agendaTriggerEnginePool.get(agendaId),
        });
        return container.resolve(AgendaService);
    }
}

export const agendaRoutes = new AgendaRoutes();
