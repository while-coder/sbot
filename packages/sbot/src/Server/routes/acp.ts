import express from 'express';
import { ACPAgentPool } from '../../Agent/ACPAgentPool';
import { api } from '../utils';
import type { RouteContext } from './types';

export class AcpRoutes {
    register(app: express.Application, _ctx: RouteContext): void {
        app.get('/api/acp-sessions', api(() => ACPAgentPool.getInstance().list()));

        app.delete('/api/acp-sessions/:key', api(async req => {
            const key = decodeURIComponent(req.params.key as string);
            await ACPAgentPool.getInstance().release(key);
            return { success: true };
        }));

        app.delete('/api/acp-sessions', api(async () => {
            await ACPAgentPool.getInstance().disposeAll();
            return { success: true };
        }));
    }
}

export const acpRoutes = new AcpRoutes();
