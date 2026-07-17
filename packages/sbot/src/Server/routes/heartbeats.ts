import express from 'express';
import { heartbeatService } from '../../Heartbeat/HeartbeatService';
import { api, throwBad } from '../../utils';
import type { RouteContext } from './types';

export class HeartbeatRoutes {
    register(app: express.Application, _ctx: RouteContext): void {
        app.get('/api/heartbeats', api(async () => {
            return heartbeatService.getStatus();
        }));

        app.post('/api/heartbeats', api(async req => {
            return heartbeatService.create(req.body);
        }));

        app.put('/api/heartbeats/:id', api(async req => {
            const id = Number(req.params.id);
            if (!id) throwBad('Invalid heartbeat id');
            const row = await heartbeatService.update(id, req.body);
            if (!row) throwBad('Heartbeat not found');
            return row;
        }));

        app.delete('/api/heartbeats/:id', api(async req => {
            const id = Number(req.params.id);
            if (!id) throwBad('Invalid heartbeat id');
            await heartbeatService.delete(id);
            return { deleted: true };
        }));

        app.post('/api/heartbeats/:id/trigger', api(async req => {
            const id = Number(req.params.id);
            if (!id) throwBad('Invalid heartbeat id');
            const row = await heartbeatService.getById(id);
            if (!row) throwBad('Heartbeat not found');
            await heartbeatService.triggerOnce(id);
            return { triggered: true };
        }));

        app.post('/api/heartbeats/reload', api(async () => {
            await heartbeatService.reloadAll();
            return { reloaded: true };
        }));
    }
}

export const heartbeatRoutes = new HeartbeatRoutes();
