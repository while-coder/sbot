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
import type { ChannelSessionRow } from '../../Core/Database';
import { database } from '../../Core/Database';
import { LoggerService } from '../../Core/LoggerService';
import { api, throwBad } from '../utils';
import type { RouteContext } from './types';

const ADMIN_DESCS: AgendaToolDescs = {
    create: 'Create agenda item from admin API',
    list: 'List agenda items from admin API',
    update: 'Update agenda item from admin API',
    complete: 'Complete agenda item from admin API',
    cancel: 'Cancel agenda item from admin API',
    skipNext: 'Skip next agenda trigger from admin API',
};

function num(v: unknown): number | undefined {
    if (v == null || v === '') return undefined;
    const n = Number(v);
    return Number.isInteger(n) ? n : undefined;
}

export class AgendaRoutes {
    register(app: express.Application, _ctx: RouteContext): void {
        app.get('/api/agendas', api(async req => {
            const profileId = num(req.query.profileId);
            if (req.query.profileId != null && !profileId) throwBad('Invalid profileId');
            const filter = this.parseFilter(req.query);
            if (profileId) {
                const service = await this.createService(profileId, await this.resolveChannelSessionId(profileId));
                return service.list(filter);
            }
            const profileIds = await agendaStorePool.listAllProfileIds();
            const records = await agendaStorePool.listItemsAcross(profileIds);
            return AgendaService.buildList(records, filter);
        }));

        app.post('/api/agendas', api(async req => {
            const body = req.body || {};
            const profileId = Number(body.profileId);
            if (!Number.isInteger(profileId) || profileId <= 0) throwBad('Invalid profileId');
            const service = await this.createService(profileId, await this.resolveChannelSessionId(profileId, body.channelSessionId));
            return service.create({
                content: String(body.content ?? ''),
                category: body.category,
                priority: body.priority,
                at: body.at,
                after: body.after,
                every: body.every,
                cron: body.cron,
                timezone: body.timezone,
                action: body.action,
                message: body.message,
                completionMode: body.completionMode,
            });
        }));

        app.patch('/api/agendas/:id', api(async req => {
            const id = Number(req.params.id);
            if (!Number.isInteger(id) || id <= 0) throwBad('Invalid id');
            const item = (await agendaStorePool.findItem(id))?.item;
            if (!item) throwBad('Agenda item not found');
            const service = await this.createService(item.profileId, await this.resolveChannelSessionId(item.profileId));
            const updated = await service.update(id, req.body || {});
            if (!updated) throwBad('Agenda item not found');
            return updated;
        }));

        app.post('/api/agendas/:id/complete', api(req => this.applyItemAction(this.singleParam(req.params.id), 'complete')));
        app.post('/api/agendas/:id/cancel', api(req => this.applyItemAction(this.singleParam(req.params.id), 'cancel')));
        app.post('/api/agendas/:id/skip-next', api(req => this.applyItemAction(this.singleParam(req.params.id), 'skipNext')));

        app.delete('/api/agendas/:id', api(async req => {
            const id = Number(req.params.id);
            if (!Number.isInteger(id) || id <= 0) throwBad('Invalid id');
            const store = agendaStorePool.storeForItemId(id);
            const deleted = store ? await store.deleteItem(id) : null;
            if (!deleted) throwBad('Agenda item not found');
            const engine = agendaTriggerEnginePool.get(deleted.item.profileId);
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

    private singleParam(value: string | string[]): string {
        return Array.isArray(value) ? value[0] : value;
    }

    private async applyItemAction(rawId: string, action: 'complete' | 'cancel' | 'skipNext') {
        const id = Number(rawId);
        if (!Number.isInteger(id) || id <= 0) throwBad('Invalid id');
        const item = (await agendaStorePool.findItem(id))?.item;
        if (!item) throwBad('Agenda item not found');
        const service = await this.createService(item.profileId, await this.resolveChannelSessionId(item.profileId));
        if (action === 'complete') return service.complete(id);
        if (action === 'cancel') return service.cancel(id);
        return service.skipNext(id);
    }

    private async createService(profileId: number, channelSessionId: number): Promise<AgendaService> {
        const container = new ServiceContainer();
        container.registerInstance(ILoggerService, { getLogger: (name: string) => LoggerService.getLogger(name) });
        container.registerWithArgs(AgendaService, {
            [T_AgendaChannelSessionId]: channelSessionId,
            [T_AgendaToolDescs]: ADMIN_DESCS,
            [IAgendaStore]: agendaStorePool.get(profileId),
            [IAgendaTriggerEngine]: agendaTriggerEnginePool.get(profileId),
        });
        return container.resolve(AgendaService);
    }

    private async resolveChannelSessionId(profileId: number, preferred?: unknown): Promise<number> {
        const p = Number(preferred);
        if (Number.isInteger(p) && p > 0) return p;
        const session = await database.findOne<ChannelSessionRow>(database.channelSession, {
            where: { profileId },
            order: [['id', 'ASC']],
        });
        return session?.id ?? 0;
    }
}

export const agendaRoutes = new AgendaRoutes();
