import express, { Request, Response } from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { WebSocket, WebSocketServer } from 'ws';
import { AgentToolService, SkillService, ModelProvider, listThreadIds, type StoredMessage } from "scorpio.ai";
import { config } from '../Core/Config';
import { AgentRunner } from '../Agent/AgentRunner';
import { globalAgentToolService, refreshGlobalAgentToolService, refreshBuiltinTools, BuiltinProvider } from '../Agent/GlobalAgentToolService';
import { globalSkillService, refreshGlobalSkillService, getSkillsDirsMap } from '../Agent/GlobalSkillService';
import { SkillHubService, type HubSkillResult } from '../SkillHub';
import { LoggerService } from '../Core/LoggerService';
import { database } from '../Core/Database';
import { sessionManager } from '../UserService/SessionManager';
import { schedulerService } from '../Scheduler/SchedulerService';
import { channelManager } from '../Channel/ChannelManager';
import { sessionThreadId, dirThreadId, WsCommandType } from 'sbot.commons';

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

/** 注册标准 Settings CRUD 路由 (POST/PUT/DELETE) */
function registerSettingsCrud(
    app: express.Application,
    section: string,
    opts?: {
        label?: string;
        checkOnUpdate?: boolean;
        checkOnDelete?: boolean;
        afterSave?: () => Promise<void> | void;
        createReturn?: (id: string, body: any) => any;
    },
) {
    const label = opts?.label ?? section.charAt(0).toUpperCase() + section.slice(1, -1);
    const checkOnUpdate = opts?.checkOnUpdate ?? true;
    const checkOnDelete = opts?.checkOnDelete ?? false;
    const getSection = (): Record<string, any> => {
        const s = config.settings as any;
        if (!s[section]) s[section] = {};
        return s[section];
    };

    app.post(`/api/settings/${section}`, api(async req => {
        const map = getSection();
        let id = randomUUID();
        while (map[id]) id = randomUUID();
        map[id] = req.body;
        config.saveSettings();
        await opts?.afterSave?.();
        return opts?.createReturn ? opts.createReturn(id, req.body) : config.settings;
    }));

    app.put(`/api/settings/${section}/:id`, api(async req => {
        const id = req.params.id as string;
        const map = getSection();
        if (checkOnUpdate && !map[id]) throwBad(`${label} "${id}" not found`);
        map[id] = req.body;
        config.saveSettings();
        await opts?.afterSave?.();
        return opts?.createReturn ? opts.createReturn(id, req.body) : config.settings;
    }));

    app.delete(`/api/settings/${section}/:id`, api(async req => {
        const id = req.params.id as string;
        const map = getSection();
        if (checkOnDelete && !map[id]) throwBad(`${label} "${id}" not found`);
        delete map[id];
        config.saveSettings();
        await opts?.afterSave?.();
        return config.settings;
    }));
}

// ===== Prompts =====
const PROMPTS_DIR = path.resolve(__dirname, '../../prompts');

type PromptNode = { name: string; type: 'file' | 'dir'; path: string; isOverride?: boolean; children?: PromptNode[] };

function safePromptRelPath(relPath: string): string {
    if (!relPath?.trim()) throwBad('path is required');
    const normalized = path.normalize(relPath.trim()).replace(/\\/g, '/');
    if (normalized.startsWith('..') || path.isAbsolute(normalized)) throwBad('Invalid path');
    return normalized;
}

function buildPromptTree(dir: string, basePath = '', userBaseDir = ''): PromptNode[] {
    if (!fs.existsSync(dir)) return [];
    const entries = fs.readdirSync(dir, { withFileTypes: true })
        .sort((a, b) => {
            if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
    const result: PromptNode[] = [];
    for (const entry of entries) {
        const relPath = basePath ? `${basePath}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            const children = buildPromptTree(path.join(dir, entry.name), relPath, userBaseDir);
            const anyOverride = children.some(c => c.isOverride || c.children?.some(cc => cc.isOverride));
            result.push({ name: entry.name, type: 'dir', path: relPath, isOverride: anyOverride, children });
        } else if (entry.isFile()) {
            const isOverride = userBaseDir ? fs.existsSync(path.join(userBaseDir, relPath)) : false;
            result.push({ name: entry.name, type: 'file', path: relPath, isOverride });
        }
    }
    return result;
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
    const svc = new SkillService("", "", "", "");
    svc.registerSkillsDir(skillsDir);
    return svc.getAllSkills().map(s => ({ name: s.name, description: s.description }));
}

function getSkill(skillsDir: string, name: string) {
    if (!fs.existsSync(skillsDir)) {
        const e: any = new Error(`Skill "${name}" not found`); e.status = 404; throw e;
    }
    const svc = new SkillService("", "", "", "");
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
        const start = Date.now();
        try {
            const result = await fn(req, res);
            if (!res.headersSent) res.json({ success: true, data: result ?? null });
        } catch (e: any) {
            const status = e.status ?? 500;
            res.status(status).json({ success: false, message: e.message });
            logger.warn(`${req.method} ${req.path} ${status} ${Date.now() - start}ms — ${e.message}`);
        }
    };
}

class HttpServer {
    private readonly skillHubService = new SkillHubService();
    private readonly wsClients = new Set<WebSocket>();

    broadcastToWs(data: string): void {
        for (const ws of this.wsClients) {
            if (ws.readyState === WebSocket.OPEN) ws.send(data);
        }
    }

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
        app.get('/', (_req, res) => res.redirect('/webui/'));

        const uploadDir = config.getConfigPath('upload', true);

        this.registerSystemRoutes(app);
        this.registerSettingsRoutes(app);
        this.registerDirectoryRoutes(app);
        this.registerFilesystemRoutes(app);
        this.registerMcpRoutes(app);
        this.registerSkillRoutes(app);
        this.registerSkillHubRoutes(app);
        this.registerPromptRoutes(app);
        this.registerDataRoutes(app);
        this.registerSchedulerRoutes(app);
        this.registerUserRoutes(app);
        this.registerChatRoutes(app);

        // HTTP + WebSocket 服务
        const server = http.createServer(app);

        const wss = new WebSocketServer({ server, path: '/ws/chat' });
        wss.on('connection', (ws) => {
            this.wsClients.add(ws);
            ws.on('close', () => { this.wsClients.delete(ws); });
            ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(data.toString()) as { type?: string; [key: string]: any };
                    switch (msg.type) {
                        case WsCommandType.Query: {
                            const enriched = processAttachments(msg.query?.trim() || '', msg.attachments, uploadDir);
                            if (!enriched || !msg.threadId) break;
                            sessionManager.onReceiveWebMessage(msg.threadId, enriched, msg.sessionId, msg.workPath);
                            break;
                        }
                        case WsCommandType.Approval:
                        case WsCommandType.Ask:
                        case WsCommandType.Abort: {
                            const { threadId } = msg;
                            if (threadId) sessionManager.onWebTriggerAction(threadId, msg.type!, msg);
                            break;
                        }
                    }
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
            ({ version: config.pkg.version, name: config.pkg.name, description: config.pkg.description, releasenoteEn: (config.pkg as any).releasenoteEn || '', releasenoteZh: (config.pkg as any).releasenoteZh || '' })
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
            const { httpPort, httpUrl, lark, autoApproveTools } = req.body;
            if (httpPort !== undefined) config.settings.httpPort = httpPort || undefined;
            if (httpUrl !== undefined) config.settings.httpUrl = httpUrl || undefined;
            if (lark !== undefined) (config.settings as any).lark = lark;
            if (autoApproveTools !== undefined) config.settings.autoApproveTools = autoApproveTools;
            config.saveSettings();
            return config.settings;
        }));

        // Fetch available models from a provider's baseURL
        app.post('/api/models/available', api(async req => {
            const { baseURL, apiKey, provider } = req.body as { baseURL?: string; apiKey?: string; provider?: string };

            if (provider === ModelProvider.Anthropic) {
                const base = (baseURL || 'https://api.anthropic.com').replace(/\/$/, '');
                if (!apiKey) throwBad('apiKey is required for Anthropic');
                const headers: Record<string, string> = {
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01',
                };
                const res = await fetch(`${base}/v1/models`, { headers });
                if (!res.ok) throwBad(`Anthropic request failed: ${res.status}`);
                const data: any = await res.json();
                return (data.data as any[] || []).map((m: any) => m.id as string);
            }

            if (!baseURL) throwBad('baseURL is required');
            const base = baseURL.replace(/\/$/, '');

            if (provider === ModelProvider.Ollama) {
                const res = await fetch(`${base}/api/tags`);
                if (!res.ok) throwBad(`Ollama request failed: ${res.status}`);
                const data: any = await res.json();
                return (data.models as any[] || []).map((m: any) => m.name as string);
            } else {
                // OpenAI-compatible
                const headers: Record<string, string> = { 'Content-Type': 'application/json' };
                if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
                const res = await fetch(`${base}/models`, { headers });
                if (!res.ok) throwBad(`Models request failed: ${res.status}`);
                const data: any = await res.json();
                return (data.data as any[] || [])
                    .sort((a: any, b: any) => (b.created ?? 0) - (a.created ?? 0))
                    .map((m: any) => m.id as string);
            }
        }));

        registerSettingsCrud(app, 'models', { label: 'Model' });
        registerSettingsCrud(app, 'embeddings', { label: 'Embedding' });
        registerSettingsCrud(app, 'savers', { label: 'Saver config' });
        registerSettingsCrud(app, 'memories', { label: 'Memory config' });
        registerSettingsCrud(app, 'agents', { label: 'Agent', checkOnUpdate: false });
        registerSettingsCrud(app, 'channels', {
            label: 'Channel',
            checkOnUpdate: true,
            checkOnDelete: true,
            afterSave: () => channelManager.reload(),
            createReturn: (id, body) => ({ id, ...body }),
        });
        registerSettingsCrud(app, 'sessions', {
            label: 'Session',
            createReturn: (id) => ({ id }),
        });
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
            const { path: dirPath, agent, saver, memories } = req.body;
            if (!dirPath) throwBad('path is required');
            if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory())
                throwBad(`Path does not exist or is not a directory: ${dirPath}`);
            config.saveDirectoryConfig(dirPath, { agent: agent || undefined, saver: saver || undefined, memories: memories || [] });
            if (!config.settings.directories) config.settings.directories = {};
            config.settings.directories[dirPath] = {};
            config.saveSettings();
            return { path: dirPath };
        }));

        app.put('/api/directories', api(req => {
            const { path: dirPath, agent, saver, memories } = req.body;
            if (!dirPath) throwBad('path is required');
            if (!config.settings.directories?.[dirPath]) throwBad(`Directory "${dirPath}" is not registered`);
            config.saveDirectoryConfig(dirPath, { agent: agent || undefined, saver: saver || undefined, memories: memories || [] });
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

    // ===== Prompts =====
    private registerPromptRoutes(app: express.Application) {
        app.get('/api/prompts/tree', api(() => {
            const userBaseDir = config.getConfigPath('prompts', true);
            return buildPromptTree(PROMPTS_DIR, '', userBaseDir);
        }));

        app.get('/api/prompts/content', api(req => {
            const relPath = safePromptRelPath(req.query.path as string);
            const userPath = config.getConfigPath(`prompts/${relPath}`);
            const defaultPath = path.join(PROMPTS_DIR, relPath);
            if (fs.existsSync(userPath)) {
                return { path: relPath, content: fs.readFileSync(userPath, 'utf-8'), isOverride: true };
            } else if (fs.existsSync(defaultPath)) {
                return { path: relPath, content: fs.readFileSync(defaultPath, 'utf-8'), isOverride: false };
            } else {
                const e: any = new Error(`Prompt "${relPath}" not found`); e.status = 404; throw e;
            }
        }));

        app.put('/api/prompts/content', api(async req => {
            const { path: relPath, content } = req.body;
            const safe = safePromptRelPath(relPath);
            const userPath = config.getConfigPath(`prompts/${safe}`);
            fs.writeFileSync(userPath, content ?? '', 'utf-8');
            await refreshBuiltinTools();
            return { path: safe };
        }));

        app.delete('/api/prompts/content', api(async req => {
            const relPath = safePromptRelPath(req.query.path as string);
            const userPath = config.getConfigPath(`prompts/${relPath}`);
            if (fs.existsSync(userPath)) fs.unlinkSync(userPath);
            await refreshBuiltinTools();
            return { path: relPath };
        }));
    }

    // ===== Data (Savers & Memories) =====
    private formatMessages(items: StoredMessage[]) {
        return items.map(({ message: m, createdAt, thinkId }) => {
            const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
            const result: any = { role: m.role, content };
            if (m.tool_calls?.length) result.tool_calls = m.tool_calls;
            if (m.tool_call_id) result.tool_call_id = m.tool_call_id;
            if (m.name) result.name = m.name;
            if (thinkId) result.think_id = thinkId;
            if (createdAt) result.timestamp = new Date(createdAt * 1000).toISOString();
            return result;
        });
    }

    private registerDataRoutes(app: express.Application) {
        // ── Savers / Threads ──
        app.get('/api/savers/:saverId/threads', api(async req => {
            return listThreadIds(config.getSaverDBDir(req.params.saverId as string), ".db", ".json");
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

        app.get('/api/savers/:saverId/threads/:threadId/thinks/:thinkId', api(async req => {
            const saver = await AgentRunner.createSaverService(
                req.params.saverId as string,
                req.params.threadId as string,
            );
            const messages = await saver.getThink(req.params.thinkId as string);
            await saver.dispose();
            return this.formatMessages(messages);
        }));

        // ── Memories ──
        app.get('/api/memories/:memoryName', api(async req => {
            const threadId = req.query.threadId as string | undefined;
            const svc = await AgentRunner.createMemoryService(req.params.memoryName as string, threadId);
            const memories = (await svc.getAllMemories()).map(m => ({
                id: m.id,
                content: m.content,
                importance: m.metadata.importance,
                timestamp: m.metadata.timestamp,
                lastAccessed: m.metadata.lastAccessed,
                accessCount: m.metadata.accessCount,
            }));
            await svc.dispose();
            return memories;
        }));

        app.post('/api/memories/:memoryName/add', api(async req => {
            const { content, autoSplit } = req.body as { content?: string; autoSplit?: boolean };
            if (!content?.trim()) { const e: any = new Error('content is required'); e.status = 400; throw e; }
            const threadId = req.query.threadId as string | undefined;
            const svc = await AgentRunner.createMemoryService(req.params.memoryName as string, threadId);
            const ids = await svc.addMemoryDirect(content.trim(), { autoSplit });
            await svc.dispose();
            return { ids };
        }));

        app.post('/api/memories/:memoryName/compress', api(async req => {
            const threadId = req.query.threadId as string | undefined;
            const svc = await AgentRunner.createMemoryService(req.params.memoryName as string, threadId);
            const count = await svc.compressMemories();
            await svc.dispose();
            return { count };
        }));

        app.delete('/api/memories/:memoryName/:memoryId', api(async req => {
            const threadId = req.query.threadId as string | undefined;
            const svc = await AgentRunner.createMemoryService(req.params.memoryName as string, threadId);
            await svc.deleteMemory(req.params.memoryId as string);
            await svc.dispose();
        }));

        app.delete('/api/memories/:memoryName', api(async req => {
            const threadId = req.query.threadId as string | undefined;
            const svc = await AgentRunner.createMemoryService(req.params.memoryName as string, threadId);
            const count = await svc.clearAll();
            await svc.dispose();
            return { count };
        }));

        app.get('/api/memories/:memoryId/threads', api(async req => {
            return listThreadIds(config.getMemoryDBDir(req.params.memoryId as string), ".db");
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
            const { expr, message, type, targetId, maxRuns } = req.body;
            if (!expr?.trim()) throwBad('expr is required');
            if (!message?.trim()) throwBad('message is required');
            const scheduler = await database.create(database.scheduler, {
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
            const { expr, message, type, targetId, maxRuns } = req.body;
            const updates: any = {};
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
        app.get('/api/channel-plugins', api(async () => {
            return channelManager.getPluginList();
        }));
        app.get('/api/channel-users', api(async req => {
            const channelId = req.query.channelId as string | undefined;
            const where = channelId ? { channelId } : undefined;
            return await database.findAll(database.channelUser, { where });
        }));

        app.delete('/api/channel-users/:id', api(async req => {
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) { const e: any = new Error('Invalid id'); e.status = 400; throw e; }
            await database.destroy(database.channelUser, { where: { id } });
        }));

        app.get('/api/channel-sessions', api(async req => {
            const channelId = req.query.channelId as string | undefined;
            const where = channelId ? { channelId } : undefined;
            return await database.findAll(database.channelSession, { where });
        }));

        app.put('/api/channel-sessions/:id', api(async req => {
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) { const e: any = new Error('Invalid id'); e.status = 400; throw e; }
            const { sessionName, agentId, memories, useChannelMemories, workPath } = req.body;
            await database.update(database.channelSession, { sessionName, agentId, memories: JSON.stringify(memories || []), useChannelMemories: !!useChannelMemories, workPath: workPath || null }, { where: { id } });
        }));

        app.delete('/api/channel-sessions/:id', api(async req => {
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) { const e: any = new Error('Invalid id'); e.status = 400; throw e; }
            await database.destroy(database.channelSession, { where: { id } });
        }));
    }

    // ===== Chat =====
    private registerChatRoutes(app: express.Application) {
        app.get('/api/session-status', (req, res) => {
            const { sessionId, workPath } = req.query as { sessionId?: string; workPath?: string };
            let threadId: string | undefined;
            if (sessionId) threadId = sessionThreadId(sessionId);
            else if (workPath) threadId = dirThreadId(workPath);
            if (!threadId) { res.status(400).json({ error: 'sessionId or workPath required' }); return; }
            const info = sessionManager.getInfo(threadId);
            if (!info) { res.json(null); return; }
            res.json(info);
        });

    }
}

export const httpServer = new HttpServer();
