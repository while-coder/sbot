import express, { Request, Response } from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { WebSocketServer } from 'ws';
import { MCPServers, AgentToolService } from "scorpio.ai";
import { config } from '../Core/Config';
import { AgentRunner } from '../Agent/AgentRunner';
import { globalAgentToolService, refreshGlobalAgentToolService, BuiltinProvider } from '../Agent/GlobalAgentToolService';
import { globalSkillService, refreshGlobalSkillService, BUILTIN_SKILLS_DIR } from '../Agent/GlobalSkillService';
import { SkillHubService, type HubSkillResult } from '../SkillHub';
import { LoggerService } from '../Core/LoggerService';
import { database } from '../Core/Database';
import { userService } from '../UserService/UserService';
import { schedulerService } from '../Scheduler/SchedulerService';
import { channelManager } from '../Channel/ChannelManager';

const logger = LoggerService.getLogger('HttpServer.ts');



/**
 * 将工具的 schema 统一转换为 JSON Schema 纯对象。
 * DynamicStructuredTool 的 schema 是活的 Zod 对象（有 .parse 方法），
 * 外部 MCP 工具的 schema 已是普通 JSON Schema，直接返回即可。
 */
function toJsonSchema(schema: any): any {
    if (schema && typeof schema.parse === 'function') {
        return z.toJSONSchema(schema);
    }
    return schema;
}

// ===== Skills 辅助函数 =====
function listSkills(skillsDir: string) {
    if (!fs.existsSync(skillsDir)) return [];
    return fs.readdirSync(skillsDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .filter(d => fs.existsSync(path.join(skillsDir, d.name, 'SKILL.md')))
        .map(d => {
            const content = fs.readFileSync(path.join(skillsDir, d.name, 'SKILL.md'), 'utf-8');
            let description = '';
            const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
            if (match) {
                const descMatch = match[1].match(/description:\s*"?([^"\n]+)"?\s*$/m);
                if (descMatch) description = descMatch[1].trim();
            }
            return { name: d.name, description };
        });
}

function getSkill(skillsDir: string, name: string, fallbackDirs: string[] = []) {
    const dirs = [skillsDir, ...fallbackDirs];
    for (const dir of dirs) {
        const skillMdPath = path.join(dir, name, 'SKILL.md');
        if (fs.existsSync(skillMdPath)) {
            return { name, content: fs.readFileSync(skillMdPath, 'utf-8') };
        }
    }
    const e: any = new Error(`Skill "${name}" 不存在`);
    e.status = 404;
    throw e;
}

function saveSkill(skillsDir: string, name: string, content: string) {
    const skillDir = path.join(skillsDir, name);
    if (!fs.existsSync(skillDir)) fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content, 'utf-8');
    return { name };
}

function deleteSkill(skillsDir: string, name: string) {
    const skillDir = path.join(skillsDir, name);
    if (fs.existsSync(skillDir)) fs.rmSync(skillDir, { recursive: true, force: true });
    return { name };
}

/** 统一异常包装：捕获异常并返回标准 JSON 响应 */
function api(fn: (req: Request, res: Response) => any) {
    return async (req: Request, res: Response) => {
        try {
            const result = await fn(req, res);
            if (!res.headersSent) res.json({ success: true, data: result ?? null });
        } catch (e: any) {
            res.status(e.status ?? 500).json({ success: false, message: e.message });
        }
    };
}

class HttpServer {
    async start() {
        const port = config.getHttpPort();
        const app = express();
        app.use(express.json());

        // CORS
        app.all(/(.*)/, (_req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Credentials', 'true');
            res.header('Access-Control-Allow-Headers', 'Content-Type,Content-Length,Authorization,Accept,X-Requested-With');
            res.header('Access-Control-Allow-Methods', 'PUT,POST,GET,DELETE,OPTIONS');
            res.header('Access-Control-Max-Age', '86400');
            if (_req.method === 'OPTIONS') { res.sendStatus(200); return; }
            next();
        });

        // 静态文件
        app.use('/webui', express.static(path.resolve(__dirname, '../../webui')));
        app.use('/assets', express.static(config.getConfigPath('assets', true)));

        const uploadDir = config.getConfigPath('upload', true);

        // 根路径重定向到 /webui
        app.get('/', (_req, res) => res.redirect('/webui/'));

        // ===== Settings =====
        app.get('/api/settings', api(() => config.settings));

        // ===== Settings / General =====
        app.put('/api/settings/general', api(req => {
            const { httpPort, httpUrl, lark } = req.body;
            if (httpPort !== undefined) config.settings.httpPort = httpPort || undefined;
            if (httpUrl !== undefined) config.settings.httpUrl = httpUrl || undefined;
            if (lark !== undefined) (config.settings as any).lark = lark;
            config.saveSettings();
            return config.settings;
        }));

        // ===== Settings / Models =====
        app.post('/api/settings/models', api(req => {
            if (!config.settings.models) config.settings.models = {};
            let id = randomUUID();
            while (config.settings.models[id]) id = randomUUID();
            config.settings.models[id] = req.body;
            config.saveSettings();
            return config.settings;
        }));

        app.put('/api/settings/models/:id', api(req => {
            const id = req.params.id as string;
            if (!config.settings.models?.[id]) throwBad(`模型 "${id}" 不存在`);
            config.settings.models![id] = req.body;
            config.saveSettings();
            return config.settings;
        }));

        app.delete('/api/settings/models/:name', api(req => {
            const name = req.params.name as string;
            if (config.settings.models) delete config.settings.models[name];
            config.saveSettings();
            return config.settings;
        }));

        // ===== Settings / Embeddings =====
        app.post('/api/settings/embeddings', api(req => {
            if (!config.settings.embeddings) config.settings.embeddings = {};
            let id = randomUUID();
            while (config.settings.embeddings[id]) id = randomUUID();
            config.settings.embeddings[id] = req.body;
            config.saveSettings();
            return config.settings;
        }));

        app.put('/api/settings/embeddings/:id', api(req => {
            const id = req.params.id as string;
            if (!config.settings.embeddings?.[id]) throwBad(`Embedding "${id}" 不存在`);
            config.settings.embeddings![id] = req.body;
            config.saveSettings();
            return config.settings;
        }));

        app.delete('/api/settings/embeddings/:id', api(req => {
            const id = req.params.id as string;
            if (config.settings.embeddings) delete config.settings.embeddings[id];
            config.saveSettings();
            return config.settings;
        }));

        // ===== Settings / Savers =====
        app.post('/api/settings/savers', api(req => {
            if (!config.settings.savers) config.settings.savers = {};
            let id = randomUUID();
            while (config.settings.savers[id]) id = randomUUID();
            config.settings.savers[id] = req.body;
            config.saveSettings();
            return config.settings;
        }));

        app.put('/api/settings/savers/:id', api(req => {
            const id = req.params.id as string;
            if (!config.settings.savers?.[id]) throwBad(`存储配置 "${id}" 不存在`);
            config.settings.savers![id] = req.body;
            config.saveSettings();
            return config.settings;
        }));

        app.delete('/api/settings/savers/:id', api(req => {
            const id = req.params.id as string;
            if (config.settings.savers) delete config.settings.savers[id];
            config.saveSettings();
            return config.settings;
        }));

        // ===== Settings / Memories =====
        app.post('/api/settings/memories', api(req => {
            if (!config.settings.memories) config.settings.memories = {};
            let id = randomUUID();
            while (config.settings.memories[id]) id = randomUUID();
            config.settings.memories[id] = req.body;
            config.saveSettings();
            return config.settings;
        }));

        app.put('/api/settings/memories/:id', api(req => {
            const id = req.params.id as string;
            if (!config.settings.memories?.[id]) throwBad(`记忆配置 "${id}" 不存在`);
            config.settings.memories![id] = req.body;
            config.saveSettings();
            return config.settings;
        }));

        app.delete('/api/settings/memories/:id', api(req => {
            const id = req.params.id as string;
            if (config.settings.memories) delete config.settings.memories[id];
            config.saveSettings();
            return config.settings;
        }));

        // ===== Settings / Agents =====
        app.post('/api/settings/agents', api(req => {
            const id = randomUUID();
            if (!config.settings.agents) config.settings.agents = {};
            config.settings.agents[id] = req.body;
            config.saveSettings();
            return config.settings;
        }));

        app.put('/api/settings/agents/:id', api(req => {
            const id = req.params.id as string;
            if (!config.settings.agents) config.settings.agents = {};
            config.settings.agents[id] = req.body;
            config.saveSettings();
            return config.settings;
        }));

        app.delete('/api/settings/agents/:id', api(req => {
            const id = req.params.id as string;
            if (config.settings.agents) delete config.settings.agents[id];
            config.saveSettings();
            return config.settings;
        }));

        app.post('/api/settings/channels', api(async req => {
            const id = randomUUID();
            if (!config.settings.channels) config.settings.channels = {};
            config.settings.channels[id] = req.body;
            config.saveSettings();
            await channelManager.reload();
            return { id, ...req.body };
        }));

        app.put('/api/settings/channels/:id', api(async req => {
            const id = req.params.id as string;
            if (!config.settings.channels?.[id]) throwBad(`频道 "${id}" 不存在`);
            config.settings.channels[id] = req.body;
            config.saveSettings();
            await channelManager.reload();
            return { id, ...req.body };
        }));

        app.delete('/api/settings/channels/:id', api(async req => {
            const id = req.params.id as string;
            if (!config.settings.channels?.[id]) throwBad(`频道 "${id}" 不存在`);
            delete config.settings.channels[id];
            config.saveSettings();
            await channelManager.reload();
        }));

        // ===== Settings / Sessions =====
        app.post('/api/settings/sessions', api(req => {
            const id = randomUUID();
            if (!config.settings.sessions) config.settings.sessions = {};
            config.settings.sessions[id] = req.body;
            config.saveSettings();
            return { id };
        }));

        app.put('/api/settings/sessions/:id', api(req => {
            const id = req.params.id as string;
            if (!config.settings.sessions?.[id]) throwBad(`会话 "${id}" 不存在`);
            config.settings.sessions[id] = req.body;
            config.saveSettings();
            return config.settings;
        }));

        app.delete('/api/settings/sessions/:id', api(req => {
            const id = req.params.id as string;
            if (config.settings.sessions) delete config.settings.sessions[id];
            config.saveSettings();
            return config.settings;
        }));

        // ===== MCP =====
        app.get('/api/mcp', api(() => ({
            builtins: Object.values(BuiltinProvider).map(n => ({ name: n, description: globalAgentToolService.getProviderDescription(n) })),
            servers: config.getGlobalMcpServers(),
        })));

        app.put('/api/mcp', api(req => {
            const builtinSet = new Set<string>(Object.values(BuiltinProvider));
            const body = (req.body.servers ?? req.body) as Record<string, unknown>;
            const servers = Object.fromEntries(
                Object.entries(body).filter(([name]) => !builtinSet.has(name))
            ) as MCPServers;
            config.saveMcpServers(servers);
            refreshGlobalAgentToolService();
            return { builtins: Object.values(BuiltinProvider).map(n => ({ name: n, description: globalAgentToolService.getProviderDescription(n) })), servers: config.getGlobalMcpServers() };
        }));

        app.post('/api/mcp/tools', api(async req => {
            const { name } = req.body;
            if (!name) {
                const e: any = new Error('缺少 name 参数');
                e.status = 400;
                throw e;
            }
            const tools = await globalAgentToolService.getToolsFrom([name]);
            return tools.map(t => ({ name: t.name, description: t.description, parameters: toJsonSchema(t.schema) }));
        }));

        // ===== Agent MCP =====
        app.get('/api/agents/:name/mcp', api(req => {
            const agentName = req.params.name as string;
            const agent = (config.settings as any).agents?.[agentName];
            return {
                globals: (agent?.mcp as string[]) || [],
                servers: config.getAgentMcpServers(agentName),
            };
        }));

        app.put('/api/agents/:name/mcp', api(req => {
            const agentName = req.params.name as string;
            config.saveAgentMcpServers(agentName, req.body);
            const agent = (config.settings as any).agents?.[agentName];
            return {
                globals: (agent?.mcp as string[]) || [],
                servers: config.getAgentMcpServers(agentName),
            };
        }));

        app.post('/api/agents/:agentName/mcp/tools', api(async req => {
            const { name } = req.body;
            const agentName = req.params.agentName as string;
            if (!name) {
                const e: any = new Error('缺少 name 参数');
                e.status = 400;
                throw e;
            }
            const servers = config.getAgentMcpServers(agentName);
            if (!servers[name]) {
                const e: any = new Error(`Agent MCP "${name}" 不存在`);
                e.status = 404;
                throw e;
            }
            const toolService = new AgentToolService();
            toolService.registerMcpServers(servers);
            const tools = await toolService.getToolsFrom([name]);
            return tools.map(t => ({ name: t.name, description: t.description, parameters: toJsonSchema(t.schema) }));
        }));

        // ===== Skills =====
        app.get('/api/skills', api(() => {
            const normalizedBuiltinDir = path.normalize(BUILTIN_SKILLS_DIR);
            const allSkills = globalSkillService.getAllSkills();
            const builtins = allSkills
                .filter(s => path.normalize(s.path).startsWith(normalizedBuiltinDir))
                .map(s => ({ name: s.name, description: s.description }));
            const skills = allSkills
                .filter(s => !path.normalize(s.path).startsWith(normalizedBuiltinDir))
                .map(s => ({ name: s.name, description: s.description }));
            return { builtins, skills };
        }));

        app.get('/api/skills/:name', api(req => getSkill(config.getSkillsPath(), req.params.name as string, [BUILTIN_SKILLS_DIR])));

        app.put('/api/skills/:name', api(req => {
            const name = req.params.name as string;
            if (!req.body.content) { const e: any = new Error('缺少 content'); e.status = 400; throw e; }
            const result = saveSkill(config.getSkillsPath(), name, req.body.content);
            refreshGlobalSkillService();
            return result;
        }));

        app.delete('/api/skills/:name', api(req => {
            const result = deleteSkill(config.getSkillsPath(), req.params.name as string);
            refreshGlobalSkillService();
            return result;
        }));

        // ===== Skill Hub =====
        const skillHubService = new SkillHubService();

        app.get('/api/skill-hub/search', api(async req => {
            const q = (req.query.q as string) || '';
            if (!q.trim()) return [];
            const limit = Math.min(Number(req.query.limit) || 20, 50);
            return skillHubService.searchSkills(q, limit);
        }));

        app.post('/api/skill-hub/install', api(async req => {
            const { skill, overwrite = false }: { skill: HubSkillResult; overwrite: boolean } = req.body;
            if (!skill?.id) { const e: any = new Error('缺少 skill'); e.status = 400; throw e; }
            const result = await skillHubService.installSkill(skill, config.getSkillsPath(), { overwrite });
            refreshGlobalSkillService();
            return result;
        }));

        app.post('/api/skill-hub/install-url', api(async req => {
            const { url, overwrite = false }: { url: string; overwrite: boolean } = req.body;
            if (!url?.trim()) { const e: any = new Error('缺少 url'); e.status = 400; throw e; }
            const result = await skillHubService.installSkillWithUrl(url.trim(), config.getSkillsPath(), { overwrite });
            refreshGlobalSkillService();
            return result;
        }));

        // ===== Agent Skill Hub =====
        app.post('/api/agents/:agentName/skill-hub/install', api(async req => {
            const agentName = req.params.agentName as string;
            const { skill, overwrite = false }: { skill: HubSkillResult; overwrite: boolean } = req.body;
            if (!skill?.id) { const e: any = new Error('缺少 skill'); e.status = 400; throw e; }
            return await skillHubService.installSkill(skill, config.getAgentSkillsPath(agentName), { overwrite });
        }));

        app.post('/api/agents/:agentName/skill-hub/install-url', api(async req => {
            const agentName = req.params.agentName as string;
            const { url, overwrite = false }: { url: string; overwrite: boolean } = req.body;
            if (!url?.trim()) { const e: any = new Error('缺少 url'); e.status = 400; throw e; }
            return await skillHubService.installSkillWithUrl(url.trim(), config.getAgentSkillsPath(agentName), { overwrite });
        }));

        // ===== Agent Skills =====
        app.get('/api/agents/:name/skills', api(req => {
            const agentName = req.params.name as string;
            const agent = (config.settings as any).agents?.[agentName];
            const agentSkillNames: string[] = (agent?.skills as string[]) || [];
            const normalizedBuiltinDir = path.normalize(BUILTIN_SKILLS_DIR);
            const allGlobalSkills = globalSkillService.getAllSkills();
            const globals = agentSkillNames
                .map(name => allGlobalSkills.find(s => s.name === name))
                .filter((s): s is NonNullable<typeof s> => !!s)
                .map(s => ({
                    name: s.name,
                    description: s.description,
                    isBuiltin: path.normalize(s.path).startsWith(normalizedBuiltinDir),
                }));
            return {
                globals,
                skills: listSkills(config.getAgentSkillsPath(agentName)),
            };
        }));

        app.get('/api/agents/:name/skills/:skillName', api(req =>
            getSkill(config.getAgentSkillsPath(req.params.name as string), req.params.skillName as string)));

        app.put('/api/agents/:name/skills/:skillName', api(req => {
            if (!req.body.content) { const e: any = new Error('缺少 content'); e.status = 400; throw e; }
            return saveSkill(config.getAgentSkillsPath(req.params.name as string), req.params.skillName as string, req.body.content);
        }));

        app.delete('/api/agents/:name/skills/:skillName', api(req =>
            deleteSkill(config.getAgentSkillsPath(req.params.name as string), req.params.skillName as string)));


        // ===== Named Saver Threads =====
        app.get('/api/savers/:saverId/threads', api(async req => {
            const saver = await AgentRunner.createSaverService(req.params.saverId as string);
            const ids = await saver.getAllThreadIds();
            await saver.dispose();
            return ids;
        }));

        app.get('/api/savers/:saverId/threads/:threadId/history', api(async req => {
            const saver = await AgentRunner.createSaverService(
                req.params.saverId as string,
                req.params.threadId as string,
            );
            const messages = await saver.getAllMessages();
            await saver.dispose();
            return messages.map(m => {
                const mm = m as any;
                const role = mm._getType?.() ?? 'unknown';
                const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
                const result: any = { role, content };
                if (mm.tool_calls?.length) result.tool_calls = mm.tool_calls;
                if (mm.tool_call_id) result.tool_call_id = mm.tool_call_id;
                if (mm.name) result.name = mm.name;
                const createdAt = mm.additional_kwargs?.created_at;
                if (createdAt) result.timestamp = new Date(createdAt * 1000).toISOString();
                return result;
            });
        }));

        app.delete('/api/savers/:saverId/threads/:threadId/history', api(async req => {
            const saver = await AgentRunner.createSaverService(
                req.params.saverId as string,
                req.params.threadId as string,
            );
            await saver.clearMessages();
            await saver.dispose();
        }));

        // ===== Named Saver History =====
        app.get('/api/savers/:saverName/history', api(async req => {
            const saver = await AgentRunner.createSaverService(req.params.saverName as string);
            const messages = await saver.getAllMessages();
            return messages.map(m => {
                const mm = m as any;
                const role = mm._getType?.() ?? 'unknown';
                const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
                const result: any = { role, content };
                if (mm.tool_calls?.length) result.tool_calls = mm.tool_calls;
                if (mm.tool_call_id) result.tool_call_id = mm.tool_call_id;
                if (mm.name) result.name = mm.name;
                const createdAt = mm.additional_kwargs?.created_at;
                if (createdAt) result.timestamp = new Date(createdAt * 1000).toISOString();
                return result;
            });
        }));

        app.delete('/api/savers/:saverName/history', api(async req => {
            const saver = await AgentRunner.createSaverService(req.params.saverName as string);
            await saver.clearMessages();
        }));

        // ===== Named Memory =====
        app.get('/api/memories/:memoryName', api(async req => {
            const svc = await AgentRunner.createMemoryService(req.params.memoryName as string);
            return (await svc.getAllMemories()).map(m => ({
                id: m.id,
                content: m.content,
                importance: m.metadata.importance,
                timestamp: m.metadata.timestamp,
                lastAccessed: m.metadata.lastAccessed,
                accessCount: m.metadata.accessCount,
            }));
        }));

        app.delete('/api/memories/:memoryName/:memoryId', api(async req => {
            const svc = await AgentRunner.createMemoryService(req.params.memoryName as string);
            await svc.deleteMemory(req.params.memoryId as string);
        }));

        app.delete('/api/memories/:memoryName', api(async req => {
            const svc = await AgentRunner.createMemoryService(req.params.memoryName as string);
            const count = await svc.clearAll();
            return { count };
        }));

        app.post('/api/memories/:memoryName/add', api(async req => {
            const { content } = req.body as { content?: string };
            if (!content?.trim()) { const e: any = new Error('content 不能为空'); e.status = 400; throw e; }
            const svc = await AgentRunner.createMemoryService(req.params.memoryName as string);
            const ids = await svc.addMemoryDirect(content.trim());
            return { ids };
        }));

        app.post('/api/memories/:memoryName/compress', api(async req => {
            const svc = await AgentRunner.createMemoryService(req.params.memoryName as string);
            const count = await svc.compressMemories();
            return { count };
        }));

        app.get('/api/memories/:memoryId/threads', api(async req => {
            const db = await AgentRunner.createMemoryDatabase(req.params.memoryId as string);
            return await db.getAllThreadIds();
        }));

        // ===== Timers =====
        function throwBad(msg: string): never {
            const e: any = new Error(msg); e.status = 400; throw e;
        }

        app.get('/api/timers', api(async () => {
            return await database.findAll(database.scheduler);
        }));

        app.post('/api/timers', api(async req => {
            const { name, expr, message, agentName, userId, enabled } = req.body;
            if (!name?.trim()) throwBad('name 不能为空');
            if (!expr?.trim()) throwBad('expr 不能为空');
            if (!message?.trim()) throwBad('message 不能为空');
            if (!agentName?.trim()) throwBad('agentName 不能为空');
            const row = await database.create(database.scheduler, {
                name: name.trim(),
                expr: expr.trim(),
                message: message.trim(),
                agentName: agentName.trim(),
                userId: userId ?? null,
                enabled: enabled !== false,
                lastRun: null,
            });
            await schedulerService.reload((row as any).id);
            return row;
        }));

        app.put('/api/timers/:id', api(async req => {
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) throwBad('无效的 id');
            const { name, expr, message, agentName, userId, enabled } = req.body;
            if (agentName !== undefined && !agentName?.trim()) throwBad('agentName 不能为空');
            const updates: any = {};
            if (name !== undefined)      updates.name      = name;
            if (expr !== undefined)      updates.expr      = expr;
            if (message !== undefined)   updates.message   = message;
            if (agentName !== undefined) updates.agentName = agentName.trim();
            if (userId !== undefined)    updates.userId    = userId;
            if (enabled !== undefined)   updates.enabled   = enabled;
            await database.update(database.scheduler, updates, { where: { id } });
            await schedulerService.reload(id);
        }));

        app.delete('/api/timers/:id', api(async req => {
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) throwBad('无效的 id');
            schedulerService.cancel(id);
            await database.destroy(database.scheduler, { where: { id } });
        }));

        // ===== Users =====
        app.get('/api/users', api(async () => {
            return await database.findAll(database.user);
        }));

        app.delete('/api/users/:id', api(async req => {
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) { const e: any = new Error('无效的 id'); e.status = 400; throw e; }
            await database.destroy(database.user, { where: { id } });
        }));

        // ===== 操作 =====
        app.post('/api/reload', api(() => {
            config.reloadSettings();
            return { message: '配置已重载' };
        }));

        // ===== HTTP Chat (SSE) =====
        app.post('/api/chat', async (req, res) => {
            const { query, agentId, saveId, memoryId, workPath, attachments } = req.body as {
                query?: string;
                agentId?: string;
                saveId?: string;
                memoryId?: string;
                workPath?: string;
                attachments?: { name: string; type: string; dataUrl?: string; content?: string }[];
            };
            let enriched = query?.trim() || '';
            if (attachments?.length) {
                for (const att of attachments) {
                    const label = att.type?.startsWith('image/') ? '图片附件' : '文件附件';
                    const filePath = path.join(uploadDir, `${randomUUID()}-${att.name}`);
                    if (att.dataUrl) {
                        const base64 = att.dataUrl.replace(/^data:[^;]+;base64,/, '');
                        fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
                        enriched += `\n\n[${label}: ${att.name}]\n${filePath}`;
                    } else if (att.content != null) {
                        const isText = !att.type || att.type.startsWith('text/') || att.type === 'application/json';
                        fs.writeFileSync(filePath, isText ? att.content : Buffer.from(att.content, 'binary'));
                        enriched += `\n\n[${label}: ${att.name}]\n${filePath}`;
                    }
                }
            }
            if (!enriched) { res.status(400).json({ error: '消息内容不能为空' }); return; }
            try {
                await userService.onReceiveHttpMessage(enriched, agentId ?? '', saveId ?? '', memoryId ?? '', workPath ?? '', res);
            } finally {
                res.end();
            }
        });

        // ===== HTTP + WebSocket 服务 =====
        const server = http.createServer(app);

        const wss = new WebSocketServer({ server, path: '/ws/chat' });
        wss.on('connection', (ws) => {
            ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(data.toString()) as {
                        type: string;
                        query?: string;
                        sessionId?: string;
                        attachments?: { name: string; type: string; dataUrl?: string; content?: string }[];
                    };
                    if (msg.type !== 'message') return;
                    let enriched = msg.query?.trim() || '';
                    if (msg.attachments?.length) {
                        for (const att of msg.attachments) {
                            const label = att.type?.startsWith('image/') ? '图片附件' : '文件附件';
                            const filePath = path.join(uploadDir, `${randomUUID()}-${att.name}`);
                            if (att.dataUrl) {
                                const base64 = att.dataUrl.replace(/^data:[^;]+;base64,/, '');
                                fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
                                enriched += `\n\n[${label}: ${att.name}]\n${filePath}`;
                            } else if (att.content != null) {
                                const isText = !att.type || att.type.startsWith('text/') || att.type === 'application/json';
                                fs.writeFileSync(filePath, isText ? att.content : Buffer.from(att.content, 'binary'));
                                enriched += `\n\n[${label}: ${att.name}]\n${filePath}`;
                            }
                        }
                    }
                    if (enriched) userService.onReceiveWebMessage(enriched, msg.sessionId ?? '', ws);
                } catch { /* ignore malformed messages */ }
            });
        });

        server.listen(port, () => {
            logger.info(`HTTP 服务启动成功: http://127.0.0.1:${port}`);
        });
    }
}

export const httpServer = new HttpServer();
