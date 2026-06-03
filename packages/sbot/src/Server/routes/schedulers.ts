import express from 'express';
import { database, type SchedulerRow } from '../../Core/Database';
import { schedulerService } from '../../Scheduler/SchedulerService';
import { api, throwBad, toPlain } from '../utils';
import type { RouteContext } from './types';

export class SchedulerRoutes {
    register(app: express.Application, _ctx: RouteContext): void {
        app.get('/api/schedulers', api(async () => {
            const schedulers = await database.findAll<SchedulerRow>(database.scheduler, { where: { disabled: false } });
            return schedulers.map(s => ({
                ...toPlain(s),
                nextRun: schedulerService.nextDate(s.id),
            }));
        }));

        app.put('/api/schedulers/:id', api(async req => {
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) throwBad('Invalid id');
            const body = req.body || {};
            const patch: { message?: string; channelSessionId?: number; aiProcess?: boolean } = {};
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
            const row = await schedulerService.update(id, patch);
            if (!row) throwBad('Scheduler not found');
            return { ...toPlain(row), nextRun: schedulerService.nextDate(id) };
        }));

        app.delete('/api/schedulers/:id', api(async req => {
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) throwBad('Invalid id');
            await schedulerService.delete(id);
        }));
    }
}

export const schedulerRoutes = new SchedulerRoutes();
