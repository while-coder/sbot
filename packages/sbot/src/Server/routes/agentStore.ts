import express from 'express';
import { api, throwBad } from '../../utils';
import type { RouteContext } from './types';

export class AgentStoreRoutes {
    register(app: express.Application, ctx: RouteContext): void {
        app.get('/api/agent-store/list', api(() => {
            return ctx.agentStoreService.getSources();
        }));

        app.post('/api/agent-store/add', api(async req => {
            const { url, name } = req.body;
            if (!url?.trim()) throwBad('Missing url');
            ctx.agentStoreService.addSource({ url: url.trim(), name });
            return ctx.agentStoreService.getSources();
        }));

        app.post('/api/agent-store/remove', api(async req => {
            const { index } = req.body;
            if (index == null || isNaN(Number(index))) throwBad('Invalid index');
            ctx.agentStoreService.removeSource(Number(index));
            return ctx.agentStoreService.getSources();
        }));

        app.post('/api/agent-store/install', api(async req => {
            const { pkg, version, overwrite = false } = req.body;
            if (!pkg?.id) throwBad('Missing pkg.id');
            if (!version) throwBad('Missing version');
            const result = await ctx.agentStoreService.install(pkg, version, overwrite);
            return { ...result, settings: ctx.settingsWithAgents() };
        }));

        app.get('/api/agent-store/export', api(req => {
            const id = req.query.id as string | undefined;
            if (!id?.trim()) throwBad('Missing id');
            return ctx.agentStoreService.export(id.trim());
        }));
    }
}

export const agentStoreRoutes = new AgentStoreRoutes();
