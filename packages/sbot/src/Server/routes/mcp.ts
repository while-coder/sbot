import express from 'express';
import { randomUUID } from 'crypto';
import { AgentToolService } from 'scorpio.ai';
import { config } from '../../Core/Config';
import { globalAgentToolService, refreshGlobalAgentToolService, BuiltinProvider } from '../../Agent/GlobalAgentToolService';
import { api, throwBad, toJsonSchema } from '../utils';
import type { RouteContext } from './types';

export class McpRoutes {
    private listGlobalMcps() {
        return [
            ...Object.values(BuiltinProvider).map(n => ({
                id: n, name: n,
                description: globalAgentToolService.getProviderDescription(n) || '',
                source: '内置',
            })),
            ...Object.entries(config.getGlobalMcpServers()).map(([id, s]) => ({
                ...s, id,
                name: s.name || id,
                description: s.description || '',
                source: '全局',
            })),
        ];
    }

    private listAgentMcp(agentName: string) {
        let agent: any;
        try { agent = config.getAgent(agentName); } catch { /* not found */ }
        const mcp = agent?.mcp;
        const allGlobals = this.listGlobalMcps();
        const globals = mcp === '*'
            ? allGlobals
            : ((mcp as string[]) || [])
                .map(id => allGlobals.find(m => m.id === id))
                .filter((m): m is NonNullable<typeof m> => !!m);
        const servers = Object.entries(config.getAgentMcpServers(agentName)).map(([id, s]) => ({
            ...s, id,
            name: s.name || id,
            description: s.description || '',
            source: '专属',
        }));
        return { globals, servers };
    }

    register(app: express.Application, _ctx: RouteContext): void {
        // ── 全局 MCP ──
        app.get('/api/mcp', api(() => this.listGlobalMcps()));

        app.post('/api/mcp', api(req => {
            const servers = config.getGlobalMcpServers();
            let id = randomUUID();
            while (servers[id]) id = randomUUID();
            servers[id] = req.body;
            config.saveMcpServers(servers);
            refreshGlobalAgentToolService();
            return this.listGlobalMcps();
        }));

        app.put('/api/mcp/:id', api(req => {
            const id = req.params.id as string;
            const servers = config.getGlobalMcpServers();
            if (!servers[id]) throwBad(`MCP "${id}" not found`);
            servers[id] = req.body;
            config.saveMcpServers(servers);
            refreshGlobalAgentToolService();
            return this.listGlobalMcps();
        }));

        app.delete('/api/mcp/:id', api(req => {
            const id = req.params.id as string;
            const servers = config.getGlobalMcpServers();
            delete servers[id];
            config.saveMcpServers(servers);
            refreshGlobalAgentToolService();
            return this.listGlobalMcps();
        }));

        app.get('/api/mcp/:id/details', api(async req => {
            const id = req.params.id as string;
            const results = await globalAgentToolService.getProviderResultsByName([id]);
            const r = results.get(id);
            return {
                tools: (r?.tools ?? []).map((t: any) => ({ name: t.name, description: t.description, parameters: toJsonSchema(t.schema) })),
                prompts: r?.prompts ?? [],
                resources: r?.resources ?? [],
                resourceTemplates: r?.resourceTemplates ?? [],
            };
        }));

        // ── Agent MCP ──
        app.get('/api/agents/:name/mcp', api(req =>
            this.listAgentMcp(req.params.name as string)
        ));

        app.post('/api/agents/:name/mcp', api(req => {
            const agentName = req.params.name as string;
            const servers = config.getAgentMcpServers(agentName);
            let id = randomUUID();
            while (servers[id]) id = randomUUID();
            servers[id] = req.body;
            config.saveAgentMcpServers(agentName, servers);
            return this.listAgentMcp(agentName);
        }));

        app.put('/api/agents/:name/mcp/:id', api(req => {
            const agentName = req.params.name as string;
            const id = req.params.id as string;
            const servers = config.getAgentMcpServers(agentName);
            if (!servers[id]) throwBad(`Agent MCP "${id}" not found`);
            servers[id] = req.body;
            config.saveAgentMcpServers(agentName, servers);
            return this.listAgentMcp(agentName);
        }));

        app.delete('/api/agents/:name/mcp/:id', api(req => {
            const agentName = req.params.name as string;
            const id = req.params.id as string;
            const servers = config.getAgentMcpServers(agentName);
            delete servers[id];
            config.saveAgentMcpServers(agentName, servers);
            return this.listAgentMcp(agentName);
        }));

        app.get('/api/agents/:name/mcp/:id/details', api(async req => {
            const agentName = req.params.name as string;
            const id = req.params.id as string;
            const servers = config.getAgentMcpServers(agentName);
            if (!servers[id]) {
                const e: any = new Error(`Agent MCP "${id}" not found`); e.status = 404; throw e;
            }
            const toolService = new AgentToolService();
            toolService.registerMcpServers(servers);
            const results = await toolService.getProviderResultsByName([id]);
            const r = results.get(id);
            return {
                tools: (r?.tools ?? []).map((t: any) => ({ name: t.name, description: t.description, parameters: toJsonSchema(t.schema) })),
                prompts: r?.prompts ?? [],
                resources: r?.resources ?? [],
                resourceTemplates: r?.resourceTemplates ?? [],
            };
        }));
    }
}

export const mcpRoutes = new McpRoutes();
