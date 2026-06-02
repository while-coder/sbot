import express from 'express';
import fsp from 'fs/promises';
import { config } from '../../Core/Config';
import { database, getChannelSession, type ChannelSessionRow } from '../../Core/Database';
import { WEB_CHANNEL_ID } from 'sbot.commons';
import { todoFileHelper } from '../helpers/todoFile';
import { api, throwBad } from '../utils';
import type { RouteContext } from './types';

export class TodoRoutes {
    // 把 channel_session 行转换成 todo 文件实际写入时使用的 threadId（= String(profile.id)）
    private sessionThreadId(s: ChannelSessionRow): string {
        return s.profileId > 0 ? String(s.profileId) : s.sessionId;
    }

    private async resolveTodoFilePath(dbSessionId: string): Promise<string> {
        const row = await getChannelSession(dbSessionId);
        if (!row) { const e: any = new Error(`channel_session id=${dbSessionId} not found`); e.status = 404; throw e; }
        return config.getSessionTodoPath(this.sessionThreadId(row));
    }

    register(app: express.Application, _ctx: RouteContext): void {
        // 列出 todo（默认 pending，跨所有 session）
        // 支持 query:
        //   dbSessionId=过滤单个 session（数据库主键）
        //   sessionId=过滤 web channel 下的 session（UUID 字符串）
        //   status=pending|done|all
        app.get('/api/todos', api(async req => {
            const dbSessionIdQ = req.query.dbSessionId as string | undefined;
            const sessionIdQ   = req.query.sessionId   as string | undefined;
            const statusQ = (req.query.status as string | undefined) ?? 'pending';
            const where: any = {};
            if (dbSessionIdQ) where.id = parseInt(dbSessionIdQ, 10);
            else if (sessionIdQ) { where.channelId = WEB_CHANNEL_ID; where.sessionId = sessionIdQ; }
            const sessions = await database.findAll<ChannelSessionRow>(database.channelSession, { where });
            const all: any[] = [];
            for (const s of sessions) {
                const filePath = config.getSessionTodoPath(this.sessionThreadId(s));
                try {
                    const buf = await fsp.readFile(filePath, 'utf-8');
                    const data = JSON.parse(buf);
                    for (const t of data.todos ?? []) {
                        all.push({ ...t, dbSessionId: s.id, sessionName: s.sessionName || s.autoSessionName, channelId: s.channelId });
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

        app.patch('/api/todos/:dbSessionId/:id', api(async req => {
            const dbSessionId = req.params.dbSessionId as string;
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) throwBad('Invalid id');
            const filePath = await this.resolveTodoFilePath(dbSessionId);
            await todoFileHelper.mutate(filePath, data => {
                const t = data.todos.find((x: any) => x.id === id);
                if (!t) throwBad('Todo not found');
                t.status = 'done';
                t.doneAt = new Date().toISOString();
            });
        }));

        app.delete('/api/todos/:dbSessionId/:id', api(async req => {
            const dbSessionId = req.params.dbSessionId as string;
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) throwBad('Invalid id');
            const filePath = await this.resolveTodoFilePath(dbSessionId);
            await todoFileHelper.mutate(filePath, data => {
                const idx = data.todos.findIndex((x: any) => x.id === id);
                if (idx < 0) throwBad('Todo not found');
                data.todos.splice(idx, 1);
            });
        }));
    }
}

export const todoRoutes = new TodoRoutes();
