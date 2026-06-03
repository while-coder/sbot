import express from 'express';
import fsp from 'fs/promises';
import { config } from '../../Core/Config';
import { database, type ChannelSessionRow } from '../../Core/Database';
import { todoFileHelper } from '../helpers/todoFile';
import { api, throwBad } from '../utils';
import type { RouteContext } from './types';

export class TodoRoutes {
    private resolveTodoFilePath(profileId: string): string {
        const id = Number(profileId);
        if (!Number.isInteger(id) || id <= 0) throwBad('Invalid profileId');
        return config.getProfileTodoPath(String(id));
    }

    register(app: express.Application, _ctx: RouteContext): void {
        // 列出 todo（默认 pending，跨所有 session）
        // 支持 query:
        //   profileId=过滤 profile/thread
        //   status=pending|done|all
        app.get('/api/todos', api(async req => {
            const profileIdQ   = req.query.profileId   as string | undefined;
            const statusQ = (req.query.status as string | undefined) ?? 'pending';
            const where: any = {};
            if (profileIdQ) where.profileId = parseInt(profileIdQ, 10);
            const sessions = await database.findAll<ChannelSessionRow>(database.channelSession, { where });
            const all: any[] = [];
            const seenProfileIds = new Set<number>();
            for (const s of sessions) {
                if (seenProfileIds.has(s.profileId)) continue;
                seenProfileIds.add(s.profileId);
                const filePath = config.getProfileTodoPath(String(s.profileId));
                try {
                    const buf = await fsp.readFile(filePath, 'utf-8');
                    const data = JSON.parse(buf);
                    for (const t of data.todos ?? []) {
                        all.push({ ...t, key: `${s.profileId}:${t.id}`, profileId: s.profileId, sessionName: s.sessionName || s.autoSessionName, channelId: s.channelId });
                    }
                } catch (e: any) {
                    if (e.code !== 'ENOENT') {
                        // ignore — corrupt todos files shouldn't break admin list
                    }
                }
            }
            if (statusQ === 'all') return all;
            return all.filter(t => t.status === statusQ);
        }));

        app.patch('/api/todos/:profileId/:id', api(async req => {
            const profileId = req.params.profileId as string;
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) throwBad('Invalid id');
            const filePath = this.resolveTodoFilePath(profileId);
            await todoFileHelper.mutate(filePath, data => {
                const t = data.todos.find((x: any) => x.id === id);
                if (!t) throwBad('Todo not found');
                t.status = 'done';
                t.doneAt = new Date().toISOString();
            });
        }));

        app.delete('/api/todos/:profileId/:id', api(async req => {
            const profileId = req.params.profileId as string;
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) throwBad('Invalid id');
            const filePath = this.resolveTodoFilePath(profileId);
            await todoFileHelper.mutate(filePath, data => {
                const idx = data.todos.findIndex((x: any) => x.id === id);
                if (idx < 0) throwBad('Todo not found');
                data.todos.splice(idx, 1);
            });
        }));
    }
}

export const todoRoutes = new TodoRoutes();
