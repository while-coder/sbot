import express from 'express';
import { schedulerService } from '../../Scheduler/SchedulerService';
import { api, throwBad, toPlain } from '../utils';
import type { RouteContext } from './types';

export class SchedulerRoutes {
    register(app: express.Application, _ctx: RouteContext): void {
        app.get('/api/schedulers', api(async req => {
            const profileId = req.query.profileId != null ? Number(req.query.profileId) : undefined;
            if (profileId != null && !Number.isInteger(profileId)) throwBad('Invalid profileId');
            const rows = await schedulerService.list(profileId);
            return rows.map(r => ({ ...toPlain(r), nextRun: r.nextRun }));
        }));

        app.put('/api/schedulers/:id', api(async req => {
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) throwBad('Invalid id');
            const body = req.body || {};
            const patch: { message?: string; channelSessionId?: number; aiProcess?: boolean; enabled?: boolean } = {};
            if (typeof body.message === 'string') {
                if (!body.message.trim()) throwBad('message is required');
                patch.message = body.message.trim();
            }
            if (body.channelSessionId != null) {
                const cid = Number(body.channelSessionId);
                if (!Number.isInteger(cid) || cid <= 0) throwBad('Invalid channelSessionId');
                patch.channelSessionId = cid;
            }
            if (typeof body.aiProcess === 'boolean') patch.aiProcess = body.aiProcess;
            if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
            const row = await schedulerService.update(id, patch);
            if (!row) throwBad('Scheduler not found');
            return { ...toPlain(row), nextRun: schedulerService.nextDate(id) };
        }));

        app.delete('/api/schedulers/:id', api(async req => {
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) throwBad('Invalid id');
            await schedulerService.delete(id);
        }));

        app.post('/api/schedulers/:id/trigger', api(async req => {
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) throwBad('Invalid id');
            const row = await schedulerService.findByPk(id);
            if (!row) throwBad('Scheduler not found');
            await schedulerService.triggerOnce(id);
            return { triggered: true };
        }));
    }
}

export const schedulerRoutes = new SchedulerRoutes();
