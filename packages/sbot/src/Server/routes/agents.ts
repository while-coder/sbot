import express from 'express';
import { config, isValidAgentId } from '../../Core/Config';
import { api, throwBad } from '../utils';
import type { RouteContext } from './types';

export class AgentRoutes {
    register(app: express.Application, _ctx: RouteContext): void {
        // List all agents
        app.get('/api/agents', api(() => config.listAgents()));

        // Create agent
        app.post('/api/agents', api(req => {
            const body = req.body;
            const id = (body.id || '').trim();
            if (!id) throwBad('id is required');
            if (!isValidAgentId(id)) throwBad(`Invalid id "${id}"`);
            if (config.agentExists(id)) throwBad(`Agent "${id}" already exists`);
            config.saveAgent(id, body);
            return config.getAgent(id);
        }));

        // Get single agent
        app.get('/api/agents/:id', api(req => {
            return config.getAgent(req.params.id as string);
        }));

        // Update agent
        app.put('/api/agents/:id', api(req => {
            const id = req.params.id as string;
            config.saveAgent(id, req.body);
            return config.getAgent(id);
        }));

        // Delete agent
        app.delete('/api/agents/:id', api(req => {
            const id = req.params.id as string;
            config.deleteAgent(id);
            return { success: true };
        }));
    }
}

export const agentRoutes = new AgentRoutes();
