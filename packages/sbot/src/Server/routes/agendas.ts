import express from 'express';
import {
    AgendaPriority,
    AgendaService,
    AgendaStatus,
    type IAgendaService,
    type AgendaListFilter,
    type AgendaRecord,
    type AgendaUpdatePatch,
} from 'scorpio.ai';
import { agendaServicePool, agendaStorePool, agendaTriggerEnginePool } from '../../Agenda';
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
    const service = await agendaServicePool.acquire(agendaId);
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
                priority: body.priority,
                triggers: body.triggers,
                dueAt: body.dueAt,
                channelSessionId,
            }));
        }));

        // 只改 item 主体字段：trigger 的增改删走专门的单条端点，这里白名单丢弃 triggers / channelSessionId
        // （二者只在「整组替换 trigger」时才有意义，而本端点不做替换），避免"改个标题顺手整组重写 trigger
        // （reset fireCount / 丢弃 disabled）"的误操作。
        app.patch('/api/agendas/:id', api(async req => {
            const id = Number(req.params.id);
            if (!Number.isInteger(id) || id <= 0) throwBad('Invalid id');
            const body = req.body || {};
            const agendaId = requireAgendaId(body.agendaId ?? req.query.agendaId);
            const patch: AgendaUpdatePatch = {};
            if (body.content !== undefined) patch.content = body.content;
            if (body.priority !== undefined) patch.priority = body.priority;
            if (body.dueAt !== undefined) patch.dueAt = body.dueAt;
            return withAgendaService(agendaId, async service => {
                const updated = await service.update(id, patch);
                if (!updated) throwBad('Agenda item not found');
                return updated;
            });
        }));

        app.post('/api/agendas/:id/complete', api(req => this.applyItemAction(req, 'complete')));
        app.post('/api/agendas/:id/cancel', api(req => this.applyItemAction(req, 'cancel')));
        app.post('/api/agendas/:id/reopen', api(req => this.applyItemAction(req, 'reopen')));

        // 给某条 item 追加一条 trigger（单条精确操作，不影响其他 trigger）。
        app.post('/api/agendas/:id/triggers', api(async req => {
            const id = Number(req.params.id);
            if (!Number.isInteger(id) || id <= 0) throwBad('Invalid id');
            const body = req.body || {};
            const agendaId = requireAgendaId(body.agendaId);
            const spec = body.spec;
            if (!spec || typeof spec !== 'object') throwBad('Missing trigger spec');
            if (!String(spec.message ?? '').trim()) throwBad('Trigger message is required');
            const channelSessionId = num(body.channelSessionId) ?? num(spec.channelSessionId) ?? 0;
            return withAgendaService(agendaId, async service => {
                const record = await service.addTrigger(id, { ...spec, channelSessionId });
                if (!record) throwBad('Agenda item not found');
                return record;
            });
        }));

        // 整体覆盖某条 trigger 的 spec（fireCount / lastFiredAt reset）；单条精确，不动其他 trigger。
        app.patch('/api/agendas/triggers/:triggerId', api(async req => {
            const triggerId = Number(req.params.triggerId);
            if (!Number.isInteger(triggerId) || triggerId <= 0) throwBad('Invalid triggerId');
            const body = req.body || {};
            const agendaId = requireAgendaId(body.agendaId);
            const spec = body.spec;
            if (!spec || typeof spec !== 'object') throwBad('Missing trigger spec');
            if (!String(spec.message ?? '').trim()) throwBad('Trigger message is required');
            const channelSessionId = num(body.channelSessionId) ?? num(spec.channelSessionId) ?? 0;
            return withAgendaService(agendaId, async service => {
                const record = await service.updateTrigger(triggerId, { ...spec, channelSessionId });
                if (!record) throwBad('Trigger not found');
                return record;
            });
        }));

        // 查看某条 trigger 的触发历史（trigger_fire 审计日志，只读）：含定时与手动触发，按 firedAt DESC。
        app.get('/api/agendas/triggers/:triggerId/fires', api(async req => {
            const triggerId = Number(req.params.triggerId);
            if (!Number.isInteger(triggerId) || triggerId <= 0) throwBad('Invalid triggerId');
            const agendaId = requireAgendaId(req.query.agendaId);
            const limit = num(req.query.limit);
            return agendaStorePool.get(agendaId).listTriggerFires({ triggerId, limit });
        }));

        // 查看整条 item（含其所有 trigger）的触发历史，按 firedAt DESC 聚合。
        app.get('/api/agendas/:id/fires', api(async req => {
            const id = Number(req.params.id);
            if (!Number.isInteger(id) || id <= 0) throwBad('Invalid id');
            const agendaId = requireAgendaId(req.query.agendaId);
            const limit = num(req.query.limit);
            return agendaStorePool.get(agendaId).listTriggerFires({ itemId: id, limit });
        }));

        // 手动触发某条 trigger：立即按其 action 投递一次，不改调度状态（含已停用 trigger）。
        app.post('/api/agendas/triggers/:triggerId/fire', api(async req => {
            const triggerId = Number(req.params.triggerId);
            if (!Number.isInteger(triggerId) || triggerId <= 0) throwBad('Invalid triggerId');
            const agendaId = requireAgendaId(req.body?.agendaId ?? req.query.agendaId);
            const result = await agendaTriggerEnginePool.get(agendaId).fireManual(triggerId);
            return { triggerId, ...result };
        }));

        // 软停用某条 trigger（保留审计留痕，可再启用）：enabled=false 并撤掉内存 timer。
        app.post('/api/agendas/triggers/:triggerId/disable', api(async req => {
            const triggerId = Number(req.params.triggerId);
            if (!Number.isInteger(triggerId) || triggerId <= 0) throwBad('Invalid triggerId');
            const agendaId = requireAgendaId(req.body?.agendaId ?? req.query.agendaId);
            return withAgendaService(agendaId, async service => {
                const record = await service.removeTrigger(triggerId);
                if (!record) throwBad('Trigger not found');
                return record;
            });
        }));

        // 重新启用某条已停用的 trigger（removeTrigger 的逆操作）：重算 nextFireAt 并重挂调度。
        app.post('/api/agendas/triggers/:triggerId/reopen', api(async req => {
            const triggerId = Number(req.params.triggerId);
            if (!Number.isInteger(triggerId) || triggerId <= 0) throwBad('Invalid triggerId');
            const agendaId = requireAgendaId(req.body?.agendaId ?? req.query.agendaId);
            return withAgendaService(agendaId, async service => {
                const record = await service.reopenTrigger(triggerId);
                if (!record) throwBad('Trigger not found');
                return record;
            });
        }));

        // 物理删除某条 trigger（含已停用的审计留痕条目），并撤掉其内存 timer。
        app.delete('/api/agendas/triggers/:triggerId', api(async req => {
            const triggerId = Number(req.params.triggerId);
            if (!Number.isInteger(triggerId) || triggerId <= 0) throwBad('Invalid triggerId');
            const agendaId = requireAgendaId(req.body?.agendaId ?? req.query.agendaId);
            return withAgendaService(agendaId, async service => {
                const record = await service.deleteTrigger(triggerId);
                if (!record) throwBad('Trigger not found');
                return { triggerId };
            });
        }));

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
        if (query.priority && Object.values(AgendaPriority).includes(query.priority)) filter.priority = query.priority as AgendaPriority;
        const limit = num(query.limit);
        if (limit && limit > 0) filter.limit = limit;
        return filter;
    }

    private parseStatus(value: any): AgendaListFilter['status'] {
        if (value && [...Object.values(AgendaStatus), 'all'].includes(value)) return value as AgendaListFilter['status'];
        return 'all';
    }

    private async applyItemAction(req: express.Request, action: 'complete' | 'cancel' | 'reopen') {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) throwBad('Invalid id');
        const agendaId = requireAgendaId(req.body?.agendaId ?? req.query.agendaId);
        return withAgendaService<AgendaRecord | null>(agendaId, service => {
            if (action === 'complete') return service.complete(id);
            if (action === 'reopen') return service.reopen(id);
            return service.cancel(id);
        });
    }
}

export const agendaRoutes = new AgendaRoutes();
