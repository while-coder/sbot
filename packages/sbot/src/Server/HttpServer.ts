import express, { Request, Response } from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { WebSocketServer } from 'ws';
import { AgentToolService, SkillService } from "scorpio.ai";
import { config } from '../Core/Config';
import { AgentRunner } from '../Agent/AgentRunner';
import { globalAgentToolService, refreshGlobalAgentToolService, BuiltinProvider } from '../Agent/GlobalAgentToolService';
import { globalSkillService, refreshGlobalSkillService, getSkillsDirsMap } from '../Agent/GlobalSkillService';
import { SkillHubService, type HubSkillResult } from '../SkillHub';
import { LoggerService } from '../Core/LoggerService';
import { database } from '../Core/Database';
import { userService } from '../UserService/UserService';
import { schedulerService } from '../Scheduler/SchedulerService';
import { channelManager } from '../Channel/ChannelManager';

const logger = LoggerService.getLogger('HttpServer.ts');

/** 将工具的 schema 统一转换为 JSON Schema 纯对象 */
function toJsonSchema(schema: any): any {
    if (schema && typeof schema.parse === 'function') {
        return z.toJSONSchema(schema);
    }
    return schema;
}

/** 统一 400 异常 */
function throwBad(msg: string): never {
    const e: any = new Error(msg); e.status = 400; throw e;
}

// ===== 附件处理 =====
type AttachmentInput = { name: string; type: string; dataUrl?: string; content?: string };

function xmlAttr(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function processAttachments(query: string, attachments: AttachmentInput[] | undefined, uploadDir: string): string {
    if (!attachments?.length) return query;
    const parts: string[] = [];
    for (const att of attachments) {
        const filePath = path.join(uploadDir, `${randomUUID()}-${att.name}`);
        if (att.dataUrl) {
            const base64 = att.dataUrl.replace(/^data:[^;]+;base64,/, '');
            fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
        } else if (att.content != null) {
            const isText = !att.type || att.type.startsWith('text/') || att.type === 'application/json';
            fs.writeFileSync(filePath, isText ? att.content : Buffer.from(att.content, 'binary'));
        } else {
            continue;
        }
        parts.push(`  <attachment name="${xmlAttr(att.name)}" type="${xmlAttr(att.type)}" path="${xmlAttr(filePath)}" />`);
    }
    if (parts.length === 0) return query;
    const xml = `<attachments>\n${parts.join('\n')}\n</attachments>`;
    return query ? `${query}\n${xml}` : xml;
}

// ===== Skills 辅助函数 =====
function listSkills(skillsDir: string) {
    if (!fs.existsSync(skillsDir)) return [];
    const svc = new SkillService();
    svc.registerSkillsDir(skillsDir);
    return svc.getAllSkills().map(s => ({ name: s.name, description: s.description }));
}

function getSkill(skillsDir: string, name: string) {
    if (!fs.existsSync(skillsDir)) {
        const e: any = new Error(`Skill "${name}" not found`); e.status = 404; throw e;
    }
    const svc = new SkillService();
    svc.registerSkillsDir(skillsDir);
    const skill = svc.getAllSkills().find(s => s.name === name);
    if (!skill) {
        const e: any = new Error(`Skill "${name}" not found`); e.status = 404; throw e;
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
    private readonly skillHubService = new SkillHubService();

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

        // 请求日志
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
        app.get('/', (_req, res) => res.redirect('/webui/'));

        const uploadDir = config.getConfigPath('upload', true);

        this.registerSystemRoutes(app);
        this.registerSettingsRoutes(app);
        this.registerDirectoryRoutes(app);
        this.registerFilesystemRoutes(app);
        this.registerMcpRoutes(app);
        this.registerSkillRoutes(app);
        this.registerSkillHubRoutes(app);
        this.registerDataRoutes(app);
        this.registerSchedulerRoutes(app);
        this.registerUserRoutes(app);
        this.registerChatRoutes(app, uploadDir);

        // HTTP + WebSocket 服务
        const server = http.createServer(app);

        const wss = new WebSocketServer({ server, path: '/ws/chat' });
        wss.on('connection', (ws) => {
            ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(data.toString()) as {
                        query?: string;
                        sessionId?: string;
                        workPath?: string;
                        attachments?: AttachmentInput[];
                    };
                    const enriched = processAttachments(msg.query?.trim() || '', msg.attachments, uploadDir);
                    if (enriched) userService.onReceiveWebMessage(enriched, ws, msg.sessionId, msg.workPath);
                } catch { /* ignore malformed messages */ }
            });
        });

        server.listen(port, () => {
            logger.info(`HTTP server started, admin UI available at: http://127.0.0.1:${port}`);
        });
    }

    // ===== System =====
    private registerSystemRoutes(app: express.Application) {
        app.get('/api/about', api(() =>
            ({ version: config.pkg.version, name: config.pkg.name, description: config.pkg.description, releasenote: config.pkg.releasenote || '' })
        ));

        app.post('/api/reload', api(() => {
            config.reloadSettings();
            refreshGlobalSkillService();
            refreshGlobalAgentToolService();
            return { message: 'Config reloaded' };
        }));
    }

    // ===== Settings =====
    private registerSettingsRoutes(app: express.Application) {
        app.get('/api/settings', api(() => config.settings));

        app.put('/api/settings/general', api(req => {
            const { httpPort, httpUrl, lark } = req.body;
            if (httpPort !== undefined) config.settings.httpPort = httpPort || undefined;
            if (httpUrl !== undefined) config.settings.httpUrl = httpUrl || undefined;
            if (lark !== undefined) (config.settings as any).lark = lark;
            config.saveSettings();
            return config.settings;
        }));

        // Models
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
            if (!config.settings.models?.[id]) throwBad(`Model "${id}" not found`);
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

        // Embeddings
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
            if (!config.settings.embeddings?.[id]) throwBad(`Embedding "${id}" not found`);
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

        // Savers
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
            if (!config.settings.savers?.[id]) throwBad(`Saver config "${id}" not found`);
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

        // Memories
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
            if (!config.settings.memories?.[id]) throwBad(`Memory config "${id}" not found`);
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

        // Agents
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

        // Channels
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
            if (!config.settings.channels?.[id]) throwBad(`Channel "${id}" not found`);
            config.settings.channels[id] = req.body;
            config.saveSettings();
            await channelManager.reload();
            return { id, ...req.body };
        }));
        app.delete('/api/settings/channels/:id', api(async req => {
            const id = req.params.id as string;
            if (!config.settings.channels?.[id]) throwBad(`Channel "${id}" not found`);
            delete config.settings.channels[id];
            config.saveSettings();
            await channelManager.reload();
        }));

        // Sessions
        app.post('/api/settings/sessions', api(req => {
            const id = randomUUID();
            if (!config.settings.sessions) config.settings.sessions = {};
            config.settings.sessions[id] = req.body;
            config.saveSettings();
            return { id };
        }));
        app.put('/api/settings/sessions/:id', api(req => {
            const id = req.params.id as string;
            if (!config.settings.sessions?.[id]) throwBad(`Session "${id}" not found`);
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
    }

    // ===== Directories =====
    private registerDirectoryRoutes(app: express.Application) {
        app.get('/api/directories', api(req => {
            const dir = req.query.dir as string;
            if (!dir) throwBad('dir is required');
            const exists = fs.existsSync(dir) && fs.statSync(dir).isDirectory();
            if (!exists) return { exists: false, config: null };
            return { exists: true, config: config.getDirectoryConfig(dir) };
        }));

        app.post('/api/directories', api(req => {
            const { path: dirPath, agent, saver, memory } = req.body;
            if (!dirPath) throwBad('path is required');
            if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory())
                throwBad(`Path does not exist or is not a directory: ${dirPath}`);
            config.saveDirectoryConfig(dirPath, { agent: agent || undefined, saver: saver || undefined, memory: memory || undefined });
            if (!config.settings.directories) config.settings.directories = {};
            config.settings.directories[dirPath] = {};
            config.saveSettings();
            return { path: dirPath };
        }));

        app.put('/api/directories', api(req => {
            const { path: dirPath, agent, saver, memory } = req.body;
            if (!dirPath) throwBad('path is required');
            if (!config.settings.directories?.[dirPath]) throwBad(`Directory "${dirPath}" is not registered`);
            config.saveDirectoryConfig(dirPath, { agent: agent || undefined, saver: saver || undefined, memory: memory || undefined });
            return { path: dirPath };
        }));

        app.delete('/api/directories', api(req => {
            const dirPath = req.query.path as string;
            if (!dirPath) throwBad('path is required');
            if (config.settings.directories) delete config.settings.directories[dirPath];
            config.saveSettings();
            return {};
        }));
    }

    // ===== Filesystem =====
    private registerFilesystemRoutes(app: express.Application) {
        app.get('/api/fs/list', api(req => {
            const dir = (req.query.dir as string) ?? '';

            if (!dir && process.platform === 'win32') {
                const items: string[] = [];
                for (let c = 65; c <= 90; c++) {
                    const d = String.fromCharCode(c) + ':\\';
                    try { if (fs.statSync(d).isDirectory()) items.push(d); } catch { /* 不存在跳过 */ }
                }
                return { path: '', parent: null, items };
            }

            const target = path.resolve(dir || os.homedir());
            if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) throwBad(`Path does not exist: ${target}`);

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

        app.post('/api/fs/mkdir', api(req => {
            const { path: dirPath } = req.body;
            if (!dirPath?.trim()) throwBad('path is required');
            const target = path.resolve(dirPath.trim());
            if (fs.existsSync(target)) throwBad(`Already exists: ${target}`);
            fs.mkdirSync(target, { recursive: true });
            return { path: target };
        }));
    }

    // ===== MCP =====
    private listGlobalMcps() {
        return [
            ...Object.values(BuiltinProvider).map(n => ({
                id: n, name: n,
                description: globalAgentToolService.getProviderDescription(n) || '',
                source: '内置',
            })),
            ...Object.entries(config.getGlobalMcpServers()).map(([id, s]) => ({
                ...(s as any), id,
                name: (s as any).name || id,
                description: (s as any).description || '',
                source: '全局',
            })),
        ];
    }

    private listAgentMcp(agentName: string) {
        const agent = (config.settings as any).agents?.[agentName];
        const globalIds: string[] = (agent?.mcp as string[]) || [];
        const allGlobals = this.listGlobalMcps();
        const globals = globalIds
            .map(id => allGlobals.find(m => m.id === id))
            .filter((m): m is NonNullable<typeof m> => !!m);
        const servers = Object.entries(config.getAgentMcpServers(agentName)).map(([id, s]) => ({
            ...(s as any), id,
            name: (s as any).name || id,
            description: (s as any).description || '',
            source: '专属',
        }));
        return { globals, servers };
    }

    private registerMcpRoutes(app: express.Application) {
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

        app.get('/api/mcp/:id/tools', api(async req => {
            const id = req.params.id as string;
            const tools = await globalAgentToolService.getToolsFrom([id]);
            return tools.map((t: any) => ({ name: t.name, description: t.description, parameters: toJsonSchema(t.schema) }));
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

        app.get('/api/agents/:name/mcp/:id/tools', api(async req => {
            const agentName = req.params.name as string;
            const id = req.params.id as string;
            const servers = config.getAgentMcpServers(agentName);
            if (!servers[id]) {
                const e: any = new Error(`Agent MCP "${id}" not found`); e.status = 404; throw e;
            }
            const toolService = new AgentToolService();
            toolService.registerMcpServers(servers);
            const tools = await toolService.getToolsFrom([id]);
            return tools.map((t: any) => ({ name: t.name, description: t.description, parameters: toJsonSchema(t.schema) }));
        }));
    }

    // ===== Skills =====
    private registerSkillRoutes(app: express.Application) {
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
                return { name: s.name, description: s.description, source };
            });
        }));

        app.get('/api/skills/:name', api(req => {
            const name = req.params.name as string;
            const skill = globalSkillService.getAllSkills().find((s: any) => s.name === name);
            if (!skill) {
                const e: any = new Error(`Skill "${name}" not found`); e.status = 404; throw e;
            }
            return { name, content: fs.readFileSync(path.join(skill.path, 'SKILL.md'), 'utf-8') };
        }));

        app.delete('/api/skills/:name', api(req => {
            const result = deleteSkill(config.getSkillsPath(), req.params.name as string);
            refreshGlobalSkillService();
            return result;
        }));

        // ── Agent Skills ──
        app.get('/api/agents/:name/skills', api(req => {
            const agentName = req.params.name as string;
            const agent = (config.settings as any).agents?.[agentName];
            const agentSkillNames: string[] = (agent?.skills as string[]) || [];
            const dirsMap = getSkillsDirsMap();
            const allGlobalSkills = globalSkillService.getAllSkills();
            const globals = agentSkillNames
                .map(name => allGlobalSkills.find((s: any) => s.name === name))
                .filter((s): s is NonNullable<typeof s> => !!s)
                .map(s => {
                    const normalizedPath = path.normalize(s.path);
                    let source = 'unknown';
                    for (const [sourceName, dir] of Object.entries(dirsMap)) {
                        if (normalizedPath.startsWith(path.normalize(dir))) {
                            source = sourceName;
                            break;
                        }
                    }
                    return { name: s.name, description: s.description, source };
                });
            return {
                globals,
                skills: listSkills(config.getAgentSkillsPath(agentName)).map((s: any) => ({ ...s, source: 'agent' })),
            };
        }));

        app.get('/api/agents/:name/skills/:skillName', api(req =>
            getSkill(config.getAgentSkillsPath(req.params.name as string), req.params.skillName as string)
        ));

        app.put('/api/agents/:name/skills/:skillName', api(req => {
            if (!req.body.content) { const e: any = new Error('Missing content'); e.status = 400; throw e; }
            return saveSkill(config.getAgentSkillsPath(req.params.name as string), req.params.skillName as string, req.body.content);
        }));

        app.delete('/api/agents/:name/skills/:skillName', api(req =>
            deleteSkill(config.getAgentSkillsPath(req.params.name as string), req.params.skillName as string)
        ));
    }

    // ===== Skill Hub =====
    private registerSkillHubRoutes(app: express.Application) {
        // ── 全局 Skill Hub ──
        app.get('/api/skill-hub/search', api(async req => {
            const q = (req.query.q as string) || '';
            if (!q.trim()) return [];
            const limit = Math.min(Number(req.query.limit) || 20, 50);
            return this.skillHubService.searchSkills(q, limit);
        }));

        app.post('/api/skill-hub/install', api(async req => {
            const { skill, overwrite = false }: { skill: HubSkillResult; overwrite: boolean } = req.body;
            if (!skill?.id) { const e: any = new Error('Missing skill'); e.status = 400; throw e; }
            const result = await this.skillHubService.installSkill(skill, config.getSkillsPath(), { overwrite });
            refreshGlobalSkillService();
            return result;
        }));

        app.post('/api/skill-hub/install-url', api(async req => {
            const { url, overwrite = false }: { url: string; overwrite: boolean } = req.body;
            if (!url?.trim()) { const e: any = new Error('Missing url'); e.status = 400; throw e; }
            const result = await this.skillHubService.installSkillWithUrl(url.trim(), config.getSkillsPath(), { overwrite });
            refreshGlobalSkillService();
            return result;
        }));

        // ── Agent Skill Hub ──
        app.post('/api/agents/:agentName/skill-hub/install', api(async req => {
            const agentName = req.params.agentName as string;
            const { skill, overwrite = false }: { skill: HubSkillResult; overwrite: boolean } = req.body;
            if (!skill?.id) { const e: any = new Error('Missing skill'); e.status = 400; throw e; }
            return await this.skillHubService.installSkill(skill, config.getAgentSkillsPath(agentName), { overwrite });
        }));

        app.post('/api/agents/:agentName/skill-hub/install-url', api(async req => {
            const agentName = req.params.agentName as string;
            const { url, overwrite = false }: { url: string; overwrite: boolean } = req.body;
            if (!url?.trim()) { const e: any = new Error('Missing url'); e.status = 400; throw e; }
            return await this.skillHubService.installSkillWithUrl(url.trim(), config.getAgentSkillsPath(agentName), { overwrite });
        }));
    }

    // ===== Data (Savers & Memories) =====
    private formatMessages(messages: any[]) {
        return messages.map((m: any) => {
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
    }

    private registerDataRoutes(app: express.Application) {
        // ── Savers / Threads ──
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
            return this.formatMessages(messages);
        }));

        app.delete('/api/savers/:saverId/threads/:threadId/history', api(async req => {
            const saver = await AgentRunner.createSaverService(
                req.params.saverId as string,
                req.params.threadId as string,
            );
            await saver.clearMessages();
            await saver.dispose();
        }));

        app.get('/api/savers/:saverName/history', api(async req => {
            const saver = await AgentRunner.createSaverService(req.params.saverName as string);
            const messages = await saver.getAllMessages();
            return this.formatMessages(messages);
        }));

        app.delete('/api/savers/:saverName/history', api(async req => {
            const saver = await AgentRunner.createSaverService(req.params.saverName as string);
            await saver.clearMessages();
        }));

        // ── Memories ──
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

        app.post('/api/memories/:memoryName/add', api(async req => {
            const { content } = req.body as { content?: string };
            if (!content?.trim()) { const e: any = new Error('content is required'); e.status = 400; throw e; }
            const svc = await AgentRunner.createMemoryService(req.params.memoryName as string);
            const ids = await svc.addMemoryDirect(content.trim());
            return { ids };
        }));

        app.post('/api/memories/:memoryName/compress', api(async req => {
            const svc = await AgentRunner.createMemoryService(req.params.memoryName as string);
            const count = await svc.compressMemories();
            return { count };
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

        app.get('/api/memories/:memoryId/threads', api(async req => {
            const db = await AgentRunner.createMemoryDatabase(req.params.memoryId as string);
            return await db.getAllThreadIds();
        }));
    }

    // ===== Schedulers =====
    private registerSchedulerRoutes(app: express.Application) {
        app.get('/api/schedulers', api(async () => {
            const schedulers = await database.findAll(database.scheduler);
            return (schedulers as any[]).map(s => ({
                ...(s.toJSON ? s.toJSON() : s),
                nextRun: schedulerService.nextDate((s as any).id),
            }));
        }));

        app.post('/api/schedulers', api(async req => {
            const { name, expr, message, type, targetId, maxRuns } = req.body;
            if (!name?.trim()) throwBad('name is required');
            if (!expr?.trim()) throwBad('expr is required');
            if (!message?.trim()) throwBad('message is required');
            const scheduler = await database.create(database.scheduler, {
                name: name.trim(),
                expr: expr.trim(),
                type: type ?? null,
                message: message.trim(),
                targetId: targetId ?? null,
                lastRun: null,
                runCount: 0,
                maxRuns: maxRuns ?? 0,
            });
            await schedulerService.reload((scheduler as any).id);
            return scheduler;
        }));

        app.put('/api/schedulers/:id', api(async req => {
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) throwBad('Invalid id');
            const { name, expr, message, type, targetId, maxRuns } = req.body;
            const updates: any = {};
            if (name !== undefined)     updates.name     = name;
            if (expr !== undefined)     updates.expr     = expr;
            if (message !== undefined)  updates.message  = message;
            if (type !== undefined)     updates.type     = type;
            if (targetId !== undefined) updates.targetId = targetId;
            if (maxRuns !== undefined)  updates.maxRuns  = maxRuns;
            await database.update(database.scheduler, updates, { where: { id } });
            await schedulerService.reload(id);
        }));

        app.delete('/api/schedulers/:id', api(async req => {
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) throwBad('Invalid id');
            await schedulerService.delete(id);
        }));
    }

    // ===== Users & Channel Sessions =====
    private registerUserRoutes(app: express.Application) {
        app.get('/api/channel-users', api(async req => {
            const channel = req.query.channel as string | undefined;
            const where = channel ? { channel } : undefined;
            return await database.findAll(database.channelUser, { where });
        }));

        app.delete('/api/channel-users/:id', api(async req => {
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) { const e: any = new Error('Invalid id'); e.status = 400; throw e; }
            await database.destroy(database.channelUser, { where: { id } });
        }));

        app.get('/api/channel-sessions', api(async req => {
            const channel = req.query.channel as string | undefined;
            const where = channel ? { channel } : undefined;
            return await database.findAll(database.channelSession, { where });
        }));

        app.put('/api/channel-sessions/:id', api(async req => {
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) { const e: any = new Error('Invalid id'); e.status = 400; throw e; }
            const { name, agentId, memoryId } = req.body;
            await database.update(database.channelSession, { name, agentId, memoryId }, { where: { id } });
        }));

        app.delete('/api/channel-sessions/:id', api(async req => {
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) { const e: any = new Error('Invalid id'); e.status = 400; throw e; }
            await database.destroy(database.channelSession, { where: { id } });
        }));
    }

    // ===== Chat =====
    private registerChatRoutes(app: express.Application, uploadDir: string) {
        app.post('/api/tool-approval', (req, res) => {
            const { id, approval } = req.body as { id?: string; approval?: string };
            if (!id || !approval) { res.status(400).json({ error: 'id and approval are required' }); return; }
            userService.web.resolveToolApproval(id, approval as any);
            userService.http.resolveToolApproval(id, approval as any);
            res.json({ ok: true });
        });

        app.post('/api/chat', async (req, res) => {
            const { query, sessionId, workPath, attachments } = req.body as {
                query?: string;
                sessionId?: string;
                workPath?: string;
                attachments?: AttachmentInput[];
            };
            const enriched = processAttachments(query?.trim() || '', attachments, uploadDir);
            if (!enriched) { res.status(400).json({ error: 'Message content is required' }); return; }
            try {
                await userService.onReceiveHttpMessage(enriched, res, sessionId, workPath);
            } finally {
                res.end();
            }
        });
    }
}

export const httpServer = new HttpServer();
