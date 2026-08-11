import express from 'express';
import { config } from '../../Core/Config';
import { refreshGlobalSkillService } from '../../Agent/GlobalSkillService';
import { installSkillFromZip } from '../../SkillHub/bundle';
import { api } from '../../utils';
import type { RouteContext } from './types';

export class SkillHubRoutes {
    register(app: express.Application, ctx: RouteContext): void {
        // ── 全局 Skill Hub ──
        app.get('/api/skill-hub/search', api(async req => {
            const q = (req.query.q as string) || '';
            if (!q.trim()) return [];
            const limit = Math.min(Number(req.query.limit) || 20, 50);
            return ctx.skillHubService.searchSkills(q, limit);
        }));

        app.post('/api/skill-hub/install', api(async req => {
            const { url, overwrite = false }: { url: string; overwrite: boolean } = req.body;
            if (!url?.trim()) { const e: any = new Error('Missing url'); e.status = 400; throw e; }
            const result = await ctx.skillHubService.installSkill(url.trim(), config.getSkillsPath(), { overwrite });
            refreshGlobalSkillService();
            return result;
        }));

        app.post('/api/skill-hub/install-zip', express.raw({ type: 'application/zip', limit: '20mb' }), api(async req => {
            const overwrite = req.query.overwrite === 'true';
            const buf = req.body as Buffer;
            if (!buf?.length) { const e: any = new Error('Missing zip body'); e.status = 400; throw e; }
            const result = installSkillFromZip(buf, config.getSkillsPath(), overwrite);
            refreshGlobalSkillService();
            return result;
        }));

        // ── Agent Skill Hub ──
        app.post('/api/agents/:agentName/skill-hub/install', api(async req => {
            const agentName = req.params.agentName as string;
            const { url, overwrite = false }: { url: string; overwrite: boolean } = req.body;
            if (!url?.trim()) { const e: any = new Error('Missing url'); e.status = 400; throw e; }
            return await ctx.skillHubService.installSkill(url.trim(), config.getAgentSkillsPath(agentName), { overwrite });
        }));

        app.post('/api/agents/:agentName/skill-hub/install-zip', express.raw({ type: 'application/zip', limit: '20mb' }), api(async req => {
            const agentName = req.params.agentName as string;
            const overwrite = req.query.overwrite === 'true';
            const buf = req.body as Buffer;
            if (!buf?.length) { const e: any = new Error('Missing zip body'); e.status = 400; throw e; }
            return installSkillFromZip(buf, config.getAgentSkillsPath(agentName), overwrite);
        }));
    }
}

export const skillHubRoutes = new SkillHubRoutes();
