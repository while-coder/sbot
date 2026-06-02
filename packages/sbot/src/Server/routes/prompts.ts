import express from 'express';
import fs from 'fs';
import path from 'path';
import { config } from '../../Core/Config';
import { refreshBuiltinTools } from '../../Agent/GlobalAgentToolService';
import { loadPromptMeta, type PromptVarMeta } from '../../Core/PromptLoader';
import { promptTreeHelper, type PromptNode } from '../helpers/promptTree';
import { api, safeRelPath } from '../utils';
import type { RouteContext } from './types';

export class PromptRoutes {
    register(app: express.Application, _ctx: RouteContext): void {
        app.get('/api/prompts/tree', api(() => {
            const userBaseDir = config.getConfigPath('prompts', true);
            return promptTreeHelper.build(promptTreeHelper.PROMPTS_DIR, '', userBaseDir);
        }));

        app.get('/api/prompts/files', api(req => {
            const prefix = (req.query.prefix as string || '').replace(/\\/g, '/').replace(/\/$/, '');
            const userBaseDir = config.getConfigPath('prompts', true);
            const tree = promptTreeHelper.build(promptTreeHelper.PROMPTS_DIR, '', userBaseDir);
            const flatten = (nodes: PromptNode[]): { path: string; isUserOnly?: boolean }[] => {
                const out: { path: string; isUserOnly?: boolean }[] = [];
                for (const n of nodes) {
                    if (n.type === 'file') out.push({ path: n.path, ...(n.isUserOnly ? { isUserOnly: true } : {}) });
                    else if (n.children) out.push(...flatten(n.children));
                }
                return out;
            };
            if (prefix) {
                const segments = prefix.split('/');
                let nodes: PromptNode[] = tree;
                for (const seg of segments) {
                    const dir = nodes.find(n => n.type === 'dir' && n.name === seg);
                    if (!dir || !dir.children) return [];
                    nodes = dir.children;
                }
                return flatten(nodes);
            }
            return flatten(tree);
        }));

        app.get('/api/prompts/content', api(req => {
            const relPath = safeRelPath(req.query.path as string);
            const userPath = config.getConfigPath(`prompts/${relPath}`);
            const defaultPath = path.join(promptTreeHelper.PROMPTS_DIR, relPath);
            let content: string;
            let isOverride: boolean;
            if (fs.existsSync(userPath)) {
                content = fs.readFileSync(userPath, 'utf-8');
                isOverride = true;
            } else if (fs.existsSync(defaultPath)) {
                content = fs.readFileSync(defaultPath, 'utf-8');
                isOverride = false;
            } else {
                const e: any = new Error(`Prompt "${relPath}" not found`); e.status = 404; throw e;
            }
            let vars: PromptVarMeta[] = [];
            if (fs.existsSync(defaultPath)) {
                const meta = loadPromptMeta(relPath, defaultPath);
                vars = meta.vars;
                if (!isOverride) content = meta.body;
            }
            return { path: relPath, content, isOverride, vars };
        }));

        app.put('/api/prompts/content', api(async req => {
            const { path: relPath, content } = req.body;
            const safe = safeRelPath(relPath);
            const userPath = config.getConfigPath(`prompts/${safe}`);
            fs.writeFileSync(userPath, content ?? '', 'utf-8');
            await refreshBuiltinTools();
            return { path: safe };
        }));

        app.delete('/api/prompts/content', api(async req => {
            const relPath = safeRelPath(req.query.path as string);
            const userPath = config.getConfigPath(`prompts/${relPath}`);
            if (fs.existsSync(userPath)) fs.unlinkSync(userPath);
            await refreshBuiltinTools();
            return { path: relPath };
        }));
    }
}

export const promptRoutes = new PromptRoutes();
