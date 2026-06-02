import express from 'express';
import { sessionManager } from '../../Session/SessionManager';
import type { RouteContext } from './types';

export class ChatRoutes {
    register(app: express.Application, _ctx: RouteContext): void {
        app.get('/api/session-status', async (req, res) => {
            const { profileId } = req.query as { profileId?: string };
            if (!profileId) { res.status(400).json({ error: 'profileId is required' }); return; }
            const info = sessionManager.getInfo(profileId);
            if (!info) { res.json(null); return; }
            res.json(info);
        });
    }
}

export const chatRoutes = new ChatRoutes();
