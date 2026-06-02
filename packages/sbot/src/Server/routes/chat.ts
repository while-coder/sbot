import express from 'express';
import { database, type ChannelSessionRow } from '../../Core/Database';
import { sessionManager } from '../../Session/SessionManager';
import { WEB_CHANNEL_ID } from 'sbot.commons';
import type { RouteContext } from './types';

export class ChatRoutes {
    register(app: express.Application, _ctx: RouteContext): void {
        app.get('/api/session-status', async (req, res) => {
            const { sessionId } = req.query as { sessionId?: string };
            if (!sessionId) { res.status(400).json({ error: 'sessionId is required' }); return; }
            const row = await database.findOne<ChannelSessionRow>(database.channelSession, { where: { channelId: WEB_CHANNEL_ID, sessionId } });
            const threadId = row && row.profileId > 0 ? String(row.profileId) : sessionId;
            const info = sessionManager.getInfo(threadId);
            if (!info) { res.json(null); return; }
            res.json(info);
        });
    }
}

export const chatRoutes = new ChatRoutes();
