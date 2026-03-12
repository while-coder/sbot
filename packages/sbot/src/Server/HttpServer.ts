import express, { Request, Response } from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { WebSocketServer } from 'ws';
import { MCPServers, AgentToolService, SkillService } from "scorpio.ai";
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
    const svc = new SkillService();
    svc.registerSkillsDir(skillsDir);
    return svc.getAllSkills().map(s => ({ name: s.name, description: s.description }));
}

function getSkill(skillsDir: string, name: string, fallbackDirs: string[] = []) {
    const dirs = [skillsDir, ...fallbackDirs].filter(d => fs.existsSync(d));
    const svc = new SkillService();
    dirs.forEach(d => svc.registerSkillsDir(d));
    const skill = svc.getAllSkills().find(s => s.name === name);
    if (!skill) {
        const e: any = new Error(`Skill "${name}" 不存在`);
        e.status = 404;
        throw e;
    }
    return { name, content: fs.readFileSync(path.join(skill.path, 'SKILL.md'), 'utf-8') };
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

        // 请求日志（SSE 等不走 api() wrapper 的路由）
        app.use('/api', (req, res, next) => {
            const start = Date.now();
            res.on('finish', () => {
                if (res.statusCode >= 400) {
                    logger.warn(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`);
                } else {
                    logger.info(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`);
                }
            });
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

        // ===== Directories =====
        // GET  /api/directories?dir=<path>  读取目录本地配置，同时返回路径是否存在
        app.get('/api/directories', api(req => {
            const dir = req.query.dir as string;
            if (!dir) throwBad('dir 不能为空');
            const exists = fs.existsSync(dir) && fs.statSync(dir).isDirectory();
            if (!exists) return { exists: false, config: null };
            return { exists: true, config: config.getDirectoryConfig(dir) };
        }));

        // POST /api/directories  注册目录 + 写入本地配置
        app.post('/api/directories', api(req => {
            const { path: dirPath, agent, saver, memory } = req.body;
            if (!dirPath) throwBad('path 不能为空');
            if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory())
                throwBad(`路径不存在或不是目录：${dirPath}`);
            config.saveDirectoryConfig(dirPath, { agent: agent || undefined, saver: saver || undefined, memory: memory || undefined });
            if (!config.settings.directories) config.settings.directories = {};
            config.settings.directories[dirPath] = {};
            config.saveSettings();
            return { path: dirPath };
        }));

        // PUT  /api/directories  更新目录本地配置（不改动全局 settings）
        app.put('/api/directories', api(req => {
            const { path: dirPath, agent, saver, memory } = req.body;
            if (!dirPath) throwBad('path 不能为空');
            if (!config.settings.directories?.[dirPath]) throwBad(`目录 "${dirPath}" 未注册`);
            config.saveDirectoryConfig(dirPath, { agent: agent || undefined, saver: saver || undefined, memory: memory || undefined });
            return { path: dirPath };
        }));

        // DELETE /api/directories?path=<path>  注销目录（不删除本地文件）
        app.delete('/api/directories', api(req => {
            const dirPath = req.query.path as string;
            if (!dirPath) throwBad('path 不能为空');
            if (config.settings.directories) delete config.settings.directories[dirPath];
            config.saveSettings();
            return {};
        }));

        // ===== Filesystem =====
        // GET /api/fs/list?dir=<path>  列出目录下的子目录（无参数时 Win 返回驱动器列表，其他返回 homedir）
        app.get('/api/fs/list', api(req => {
            const dir = (req.query.dir as string) ?? '';

            // Windows 根节点：枚举驱动器
            if (!dir && process.platform === 'win32') {
                const items: string[] = [];
                for (let c = 65; c <= 90; c++) {
                    const d = String.fromCharCode(c) + ':\\';
                    try { if (fs.statSync(d).isDirectory()) items.push(d); } catch { /* 不存在跳过 */ }
                }
                return { path: '', parent: null, items };
            }

            const target = path.resolve(dir || os.homedir());
            if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) throwBad(`路径不存在：${target}`);

            // 父目录：若 dirname === self 说明已到根（Win 驱动器根 / Unix /）
            const up = path.dirname(target);
            const parent: string | null = (up === target)
                ? (process.platform === 'win32' ? '' : null)
                : up;

            let entries: fs.Dirent[] = [];
            try { entries = fs.readdirSync(target, { withFileTypes: true }); } catch { /* 无权限时返回空 */ }

            const items = entries
                .filter(e => e.isDirectory())
                .map(e => path.join(target, e.name))
                .sort((a, b) => a.localeCompare(b));

            return { path: target, parent, items };
        }));

        // GET /api/fs/quickdirs  返回常用目录列表（主目录 / 桌面 / 文档 / 下载）
        app.get('/api/fs/quickdirs', api(() => {
            const home = os.homedir();
            const candidates = [
                { label: '主目录', path: home },
                { label: '桌面',   path: path.join(home, 'Desktop') },
                { label: '文档',   path: path.join(home, 'Documents') },
                { label: '下载',   path: path.join(home, 'Downloads') },
            ];
            return candidates.filter(d => {
                try { return fs.statSync(d.path).isDirectory(); } catch { return false; }
            });
        }));

        // POST /api/fs/mkdir  在当前目录下新建文件夹
        app.post('/api/fs/mkdir', api(req => {
            const { path: dirPath } = req.body;
            if (!dirPath?.trim()) throwBad('path 不能为空');
            const target = path.resolve(dirPath.trim());
            if (fs.existsSync(target)) throwBad(`已存在：${target}`);
            fs.mkdirSync(target, { recursive: true });
            return { path: target };
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
            const servers = (req.body.servers ?? req.body) as MCPServers;
            config.saveAgentMcpServers(agentName, servers);
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

        // ===== Schedulers =====
        function throwBad(msg: string): never {
            const e: any = new Error(msg); e.status = 400; throw e;
        }

        app.get('/api/schedulers', api(async () => {
            const schedulers = await database.findAll(database.scheduler);
            return (schedulers as any[]).map(s => ({
                ...(s.toJSON ? s.toJSON() : s),
                nextRun: schedulerService.nextDate((s as any).id),
            }));
        }));

        app.post('/api/schedulers', api(async req => {
            const { name, expr, message, type, userId, sessionId, workPath, maxRuns } = req.body;
            if (!name?.trim()) throwBad('name 不能为空');
            if (!expr?.trim()) throwBad('expr 不能为空');
            if (!message?.trim()) throwBad('message 不能为空');
            const scheduler = await database.create(database.scheduler, {
                name: name.trim(),
                expr: expr.trim(),
                type: type ?? null,
                message: message.trim(),
                userId: userId ?? null,
                sessionId: sessionId ?? null,
                workPath: workPath ?? null,
                lastRun: null,
                runCount: 0,
                maxRuns: maxRuns ?? 0,
            });
            await schedulerService.reload((scheduler as any).id);
            return scheduler;
        }));

        app.put('/api/schedulers/:id', api(async req => {
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) throwBad('无效的 id');
            const { name, expr, message, type, userId, sessionId, workPath, maxRuns } = req.body;
            const updates: any = {};
            if (name !== undefined)      updates.name      = name;
            if (expr !== undefined)      updates.expr      = expr;
            if (message !== undefined)   updates.message   = message;
            if (type !== undefined)      updates.type      = type;
            if (userId !== undefined)    updates.userId    = userId;
            if (sessionId !== undefined) updates.sessionId = sessionId;
            if (workPath !== undefined)  updates.workPath  = workPath;
            if (maxRuns !== undefined)   updates.maxRuns   = maxRuns;
            await database.update(database.scheduler, updates, { where: { id } });
            await schedulerService.reload(id);
        }));

        app.delete('/api/schedulers/:id', api(async req => {
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) throwBad('无效的 id');
            await schedulerService.delete(id);
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
            refreshGlobalSkillService();
            refreshGlobalAgentToolService();
            return { message: '配置已重载' };
        }));

        // ===== HTTP Chat (SSE) =====
        app.post('/api/chat', async (req, res) => {
            const { query, sessionId, workPath, attachments } = req.body as {
                query?: string;
                sessionId?: string;
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
                await userService.onReceiveHttpMessage(enriched, res, sessionId, workPath);
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
                        workPath?: string;
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
                    if (enriched) userService.onReceiveWebMessage(enriched, ws, msg.sessionId, msg.workPath);
                } catch { /* ignore malformed messages */ }
            });
        });

        server.listen(port, () => {
            logger.info(`HTTP 服务启动成功: http://127.0.0.1:${port}`);
        });
    }
}

export const httpServer = new HttpServer();
