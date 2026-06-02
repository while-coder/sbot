import express from 'express';
import path from 'path';
import { config } from '../../Core/Config';
import { globalSkillService, refreshGlobalSkillService, getSkillsDirsMap } from '../../Agent/GlobalSkillService';
import { skillHelper } from '../helpers/skillsHelpers';
import { api } from '../utils';
import type { RouteContext } from './types';

export class SkillRoutes {
    register(app: express.Application, _ctx: RouteContext): void {
        // ── 全局 Skills ──
        app.get('/api/skills', api(() => {
            const allSkills = globalSkillService.getAllSkills();
            const dirsMap = getSkillsDirsMap();
            return allSkills.map((s: any) => {
                const normalizedPath = path.normalize(s.path);
                let source = 'unknown';
                for (const [name, dir] of Object.entries(dirsMap)) {
                    if (normalizedPath.startsWith(path.normalize(dir))) {
                        source = name;
                        break;
                    }
                }
                return {
                    path: s.path,
                    name: s.name,
                    description: s.description,
                    source,
                    dirName: path.basename(s.path),
                };
            });
        }));

        app.delete('/api/skills/:name', api(req => {
            const result = skillHelper.delete(config.getSkillsPath(), req.params.name as string);
            refreshGlobalSkillService();
            return result;
        }));

        // ── Agent Skills ──
        app.get('/api/agents/:name/skills', api(req => {
            const agentName = req.params.name as string;
            let agent: any;
            try { agent = config.getAgent(agentName); } catch { /* not found */ }
            const dirsMap = getSkillsDirsMap();
            const allGlobalSkills = globalSkillService.getAllSkills();
            const skills = agent?.skills;
            const matchedSkills = skills === '*'
                ? allGlobalSkills
                : ((skills as string[]) || [])
                    .map(name => allGlobalSkills.find((s: any) => s.name === name))
                    .filter((s): s is NonNullable<typeof s> => !!s);
            const globals = matchedSkills.map(s => {
                const normalizedPath = path.normalize(s.path);
                let source = 'unknown';
                for (const [sourceName, dir] of Object.entries(dirsMap)) {
                    if (normalizedPath.startsWith(path.normalize(dir))) {
                        source = sourceName;
                        break;
                    }
                }
                return {
                    path: s.path,
                    name: s.name,
                    description: s.description,
                    source,
                    dirName: path.basename(s.path),
                };
            });
            return {
                globals,
                skills: skillHelper.list(config.getAgentSkillsPath(agentName)).map((s: any) => ({ ...s, source: 'agent' })),
            };
        }));

        app.put('/api/agents/:name/skills/:skillName', api(req => {
            if (!req.body.content) { const e: any = new Error('Missing content'); e.status = 400; throw e; }
            return skillHelper.save(config.getAgentSkillsPath(req.params.name as string), req.params.skillName as string, req.body.content);
        }));

        app.delete('/api/agents/:name/skills/:skillName', api(req =>
            skillHelper.delete(config.getAgentSkillsPath(req.params.name as string), req.params.skillName as string)
        ));
    }
}

export const skillRoutes = new SkillRoutes();
