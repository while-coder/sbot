import express from 'express';
import { getCommandMetadata } from 'scorpio.ai';
import { sessionManager } from '../../Session/SessionManager';
import { getBuiltInCommands } from '../../Session/BuiltInCommands';
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

        // 可用斜杠命令列表（供前端输入框自动补全菜单使用）
        app.get('/api/commands', async (_req, res) => {
            const commands = getBuiltInCommands()
                .map((cmd) => getCommandMetadata(Object.getPrototypeOf(cmd)))
                .filter((meta): meta is NonNullable<typeof meta> => !!meta)
                .map((meta) => ({
                    name: meta.name,
                    description: meta.description,
                    args: meta.args.map((a) => ({
                        name: a.name,
                        description: a.description,
                        required: a.required,
                    })),
                }));
            res.json({ data: commands });
        });
    }
}

export const chatRoutes = new ChatRoutes();
