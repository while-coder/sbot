import express, { Request, Response } from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { z } from 'zod';
import { MCPServers, AgentToolService } from "scorpio.ai";
import { config } from './Config';
import { AgentFactory } from './AgentFactory';
import { globalAgentToolService, refreshGlobalAgentToolService, BuiltinProvider } from './GlobalAgentToolService';
import { globalSkillService, refreshGlobalSkillService, BUILTIN_SKILLS_DIR } from './GlobalSkillService';
import { SkillHubService, type HubSkillResult } from './SkillHub';
import { LoggerService } from './LoggerService';
import { database } from './Database';
import { userService } from './UserService/UserService';
import { WebUserService } from './UserService/WebUserService';
import { schedulerService } from './SchedulerService/SchedulerService';
import { restartLarkService } from './Lark/LarkServiceInit';

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
        const port = parseInt(process.env.HTTP_PORT ?? '5500');
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
        app.use('/client', express.static(path.resolve(__dirname, '../client')));

        // 根路径重定向到 /client
        app.get('/', (_req, res) => res.redirect('/client/'));

        // ===== Settings =====
        app.get('/api/settings', api(() => config.settings));

        app.put('/api/settings', api(async req => {
            const prevLark = JSON.stringify(config.settings.lark ?? {});
            Object.assign(config.settings, req.body);
            config.saveSettings();
            if (JSON.stringify(config.settings.lark ?? {}) !== prevLark) {
                await restartLarkService();
            }
            return config.settings;
        }));

        // ===== Agent Rename =====
        app.post('/api/agents/:name/rename', api(async req => {
            const oldName = req.params.name as string;
            const { name: newName } = req.body as { name: string };
            if (!newName?.trim()) throwBad('新名称不能为空');
            if (oldName === newName) return config.settings;
            const agents = config.settings.agents;
            if (!agents?.[oldName]) throwBad(`Agent "${oldName}" 不存在`);
            if (agents[newName])    throwBad(`Agent "${newName}" 已存在`);

            // 重命名 key
            agents[newName] = agents[oldName];
            delete agents[oldName];

            // 同步 settings.agent
            if (config.settings.agent === oldName) config.settings.agent = newName;

            // 同步其他 agent 中的引用
            for (const a of Object.values(agents) as any[]) {
                if (typeof a.think === 'string'      && a.think === oldName)      a.think = newName;
                if (typeof a.supervisor === 'string' && a.supervisor === oldName) a.supervisor = newName;
                if (Array.isArray(a.agents)) {
                    for (const sub of a.agents) {
                        if (sub.name === oldName) sub.name = newName;
                    }
                }
            }

            config.saveSettings();

            // 同步 scheduler 表中的 agentName
            await database.update(database.scheduler, { agentName: newName }, { where: { agentName: oldName } });

            return config.settings;
        }));

        // ===== MCP Rename =====
        app.post('/api/mcp/:name/rename', api(req => {
            const oldName = req.params.name as string;
            const { name: newName } = req.body as { name: string };
            if (!newName?.trim()) throwBad('新名称不能为空');
            if (oldName === newName) return { builtins: Object.values(BuiltinProvider), servers: config.getGlobalMcpServers() };

            const servers = config.getGlobalMcpServers();
            if (!servers[oldName]) throwBad(`MCP "${oldName}" 不存在`);
            if (servers[newName])  throwBad(`MCP "${newName}" 已存在`);

            // 重命名 key
            servers[newName] = servers[oldName];
            delete servers[oldName];
            config.saveMcpServers(servers);

            // 同步所有 agent 的 mcp 数组
            const agents = config.settings.agents;
            if (agents) {
                for (const a of Object.values(agents) as any[]) {
                    if (Array.isArray(a.mcp)) {
                        const idx = a.mcp.indexOf(oldName);
                        if (idx !== -1) a.mcp[idx] = newName;
                    }
                }
                config.saveSettings();
            }

            refreshGlobalAgentToolService();
            return { builtins: Object.values(BuiltinProvider), servers: config.getGlobalMcpServers() };
        }));

        // ===== MCP =====
        app.get('/api/mcp', api(() => ({
            builtins: Object.values(BuiltinProvider),
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
            return { builtins: Object.values(BuiltinProvider), servers: config.getGlobalMcpServers() };
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


        // ===== Named Saver History =====
        app.get('/api/savers/:saverName/history', api(async req => {
            const saver = await AgentFactory.createSaverService(req.params.saverName as string);
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
            const saver = await AgentFactory.createSaverService(req.params.saverName as string);
            await saver.clearMessages();
        }));

        // ===== Named Memory =====
        app.get('/api/memories/:memoryName', api(async req => {
            const svc = await AgentFactory.createMemoryService(req.params.memoryName as string);
            return (await svc.getAllMemories()).map(m => ({
                id: m.id,
                content: m.content,
                importance: m.metadata.importance,
                timestamp: m.metadata.timestamp,
                lastAccessed: m.metadata.lastAccessed,
                accessCount: m.metadata.accessCount,
                category: m.metadata.category,
            }));
        }));

        app.delete('/api/memories/:memoryName/:memoryId', api(async req => {
            const svc = await AgentFactory.createMemoryService(req.params.memoryName as string);
            await svc.deleteMemory(req.params.memoryId as string);
        }));

        app.delete('/api/memories/:memoryName', api(async req => {
            const svc = await AgentFactory.createMemoryService(req.params.memoryName as string);
            const count = await svc.clearAll();
            return { count };
        }));

        app.post('/api/memories/:memoryName/add', api(async req => {
            const { content } = req.body as { content?: string };
            if (!content?.trim()) { const e: any = new Error('content 不能为空'); e.status = 400; throw e; }
            const svc = await AgentFactory.createMemoryService(req.params.memoryName as string);
            const ids = await svc.addMemoryDirect(content.trim());
            return { ids };
        }));

        app.post('/api/memories/:memoryName/compress', api(async req => {
            const svc = await AgentFactory.createMemoryService(req.params.memoryName as string);
            const count = await svc.compressMemories();
            return { count };
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

        // ===== Web 聊天（SSE 流式）=====
        app.post('/api/users/:userId/chat', (req, res) => {
            const { query, attachments } = req.body as {
                query?: string;
                attachments?: { name: string; type: string; dataUrl?: string; content?: string }[];
            };
            let enriched = query?.trim() || '';
            if (attachments?.length) {
                for (const att of attachments) {
                    if (att.type?.startsWith('image/') && att.dataUrl) {
                        enriched += `\n\n[图片附件: ${att.name}]\n${att.dataUrl}`;
                    } else if (att.content != null) {
                        enriched += `\n\n[文件附件: ${att.name}]\n\`\`\`\n${att.content}\n\`\`\``;
                    }
                }
            }
            if (!enriched) {
                res.status(400).json({ success: false, message: '消息不能为空' });
                return;
            }
            WebUserService.sendSSE(res, emit => userService.onReceiveWebMessage(enriched, emit));
        });

        // ===== 操作 =====
        app.post('/api/reload', api(() => {
            config.reloadSettings();
            return { message: '配置已重载' };
        }));

        http.createServer(app).listen(port, () => {
            logger.info(`HTTP 服务启动成功: http://127.0.0.1:${port}`);
        });
    }
}

export const httpServer = new HttpServer();
