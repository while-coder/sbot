import express, { Request, Response } from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { WebSocket, WebSocketServer } from 'ws';
import { AgentToolService, SkillService, ModelProvider, listThreadIds, listSubDirs, readImageAsDataUrl, isEmptyContent, type StoredMessage, type MessageContent } from "scorpio.ai";
import { config, sanitizeId } from '../Core/Config';
import { AgentRunner } from '../Agent/AgentRunner';
import { globalAgentToolService, refreshGlobalAgentToolService, refreshBuiltinTools, BuiltinProvider } from '../Agent/GlobalAgentToolService';
import { globalSkillService, refreshGlobalSkillService, getSkillsDirsMap } from '../Agent/GlobalSkillService';
import { SkillHubService } from '../SkillHub';
import { AgentStoreService } from '../AgentStore';
import { LoggerService, log4js } from '../Core/LoggerService';
import { database, sessionThreadId, parseMemories, type SessionRow, type TodoRow } from '../Core/Database';
import { sessionManager } from '../Session/SessionManager';
import { schedulerService } from '../Scheduler/SchedulerService';
import { channelManager } from '../Channel/ChannelManager';
import { WsCommandType } from 'sbot.commons';
import { getModelMeta, getKnownModels } from './modelCatalog';

const logger = LoggerService.getLogger('HttpServer.ts');

async function fetchAndSaveContextWindow(modelId: string): Promise<void> {
    const mc = config.getModel(modelId);
    if (!mc?.model) return;
    let contextWindow: number | undefined;
    let maxOutputTokens: number | undefined;
    try {
        const base = (mc.baseURL || '').replace(/\/$/, '');
        if (mc.provider === ModelProvider.Anthropic) {
            const url = `${base}/v1/models/${encodeURIComponent(mc.model)}`;
            const headers: Record<string, string> = { 'x-api-key': mc.apiKey, 'anthropic-version': '2023-06-01' };
            const res = await fetch(url, { headers });
            if (res.ok) {
                const data: any = await res.json();
                contextWindow = data.context_window;
                maxOutputTokens = data.max_tokens;
            }
        } else if (mc.provider === ModelProvider.Gemini || mc.provider === ModelProvider.GeminiImage) {
            const ver = mc.apiVersion || 'v1beta';
            const url = `${base}/${ver}/models/${encodeURIComponent(mc.model)}`;
            const headers: Record<string, string> = { 'x-goog-api-key': mc.apiKey };
            const res = await fetch(url, { headers });
            if (res.ok) {
                const data: any = await res.json();
                contextWindow = data.inputTokenLimit;
                maxOutputTokens = data.outputTokenLimit;
            }
        } else if (mc.provider === ModelProvider.Ollama) {
            const url = `${base}/api/show`;
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: mc.model }),
            });
            if (res.ok) {
                const data: any = await res.json();
                const info = data.model_info ?? {};
                for (const key of Object.keys(info)) {
                    if (key.includes('context_length')) { contextWindow = info[key]; break; }
                }
            }
        }
    } catch { /* ignore */ }
    if (contextWindow == null && maxOutputTokens == null) {
        const meta = getModelMeta(mc.provider, mc.model);
        if (meta) {
            contextWindow = meta.contextWindow;
            maxOutputTokens = meta.maxOutputTokens;
        }
    }
    if (contextWindow != null || maxOutputTokens != null) {
        const map = (config.settings as any).models;
        if (map?.[modelId]) {
            if (contextWindow != null) map[modelId].contextWindow = contextWindow;
            if (maxOutputTokens != null && !map[modelId].maxTokens) map[modelId].maxTokens = maxOutputTokens;
            config.saveSettings();
        }
    }
}

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
        afterSave?: (id: string) => Promise<void> | void;
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
        await opts?.afterSave?.(id);
        return opts?.createReturn ? opts.createReturn(id, req.body) : config.settings;
    }));

    app.put(`/api/settings/${section}/:id`, api(async req => {
        const id = req.params.id as string;
        const map = getSection();
        if (checkOnUpdate && !map[id]) throwBad(`${label} "${id}" not found`);
        map[id] = req.body;
        config.saveSettings();
        await opts?.afterSave?.(id);
        return opts?.createReturn ? opts.createReturn(id, req.body) : config.settings;
    }));

    app.delete(`/api/settings/${section}/:id`, api(async req => {
        const id = req.params.id as string;
        const map = getSection();
        if (checkOnDelete && !map[id]) throwBad(`${label} "${id}" not found`);
        delete map[id];
        config.saveSettings();
        await opts?.afterSave?.(id);
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
type AttachmentInput = { name: string; dataUrl?: string; content?: string };
type ContentPartInput = { type: 'text'; text: string } | { type: 'image'; dataUrl: string };

function isImageDataUrl(dataUrl: string): boolean {
    return /^data:image\//.test(dataUrl);
}

/**
 * Build MessageContent from ordered parts (interleaved text/image) + file attachments.
 * Parts preserve the interleaved order from the editor.
 * File attachments (non-inline) are appended at the end.
 */
function processMessage(parts: ContentPartInput[], attachments: AttachmentInput[] | undefined, uploadDir: string): MessageContent {
    const msgParts: Array<{ type: string; text?: string; [key: string]: any }> = [];
    let hasImage = false;

    for (const p of parts) {
        if (p.type === 'text') {
            msgParts.push({ type: 'text', text: p.text });
        } else if (p.type === 'image' && p.dataUrl) {
            msgParts.push({ type: 'image_url', image_url: { url: p.dataUrl } });
            hasImage = true;
        }
    }

    // Append file attachments (non-inline files from the attachment picker)
    if (attachments?.length) {
        for (const att of attachments) {
            if (att.dataUrl && isImageDataUrl(att.dataUrl)) {
                msgParts.push({ type: 'image_url', image_url: { url: att.dataUrl } });
                hasImage = true;
            } else if (att.dataUrl) {
                const filePath = path.join(uploadDir, `${randomUUID()}-${att.name}`);
                fs.writeFileSync(filePath, Buffer.from(att.dataUrl.replace(/^data:[^;]+;base64,/, ''), 'base64'));
                msgParts.push({ type: 'text', text: `[file: ${att.name}](${filePath})` });
            } else if (att.content != null) {
                const filePath = path.join(uploadDir, `${randomUUID()}-${att.name}`);
                fs.writeFileSync(filePath, att.content);
                msgParts.push({ type: 'text', text: `[file: ${att.name}](${filePath})` });
            }
        }
    }

    if (msgParts.length === 0) return '';
    if (!hasImage) return msgParts.map(p => p.text!).join('\n');
    return msgParts;
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

type SkillTreeNode = { name: string; type: 'file' | 'dir'; path: string; children?: SkillTreeNode[] };

function buildSkillTree(dir: string, basePath = ''): SkillTreeNode[] {
    if (!fs.existsSync(dir)) return [];
    const entries = fs.readdirSync(dir, { withFileTypes: true })
        .sort((a, b) => {
            if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
    const result: SkillTreeNode[] = [];
    for (const entry of entries) {
        const relPath = basePath ? `${basePath}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            result.push({ name: entry.name, type: 'dir', path: relPath, children: buildSkillTree(path.join(dir, entry.name), relPath) });
        } else if (entry.isFile()) {
            result.push({ name: entry.name, type: 'file', path: relPath });
        }
    }
    return result;
}

function safeSkillFilePath(filePath: string): string {
    if (!filePath?.trim()) { const e: any = new Error('path is required'); e.status = 400; throw e; }
    const normalized = path.normalize(filePath.trim()).replace(/\\/g, '/');
    if (normalized.startsWith('..') || path.isAbsolute(normalized)) { const e: any = new Error('Invalid path'); e.status = 400; throw e; }
    return normalized;
}

/** 统一异常包装：捕获异常并返回标准 JSON 响应 */
function api(fn: (req: Request, res: Response) => any) {
    return async (req: Request, res: Response) => {
        const start = Date.now();
        logger.debug(`${req.method} ${req.path} body=${JSON.stringify(req.body)} query=${JSON.stringify(req.query)}`);
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
    private readonly agentStoreService = new AgentStoreService();
    private readonly wsClients = new Set<WebSocket>();
    private server?: http.Server;

    broadcastToWs(data: string): void {
        for (const ws of this.wsClients) {
            if (ws.readyState === WebSocket.OPEN) ws.send(data);
        }
    }

    async shutdown(): Promise<void> {
        logger.info('Shutting down services...');
        try {
            schedulerService.stopAll();
            await channelManager.dispose();
            for (const ws of this.wsClients) ws.close();
            this.wsClients.clear();
            if (this.server) {
                await new Promise<void>((resolve, reject) =>
                    this.server!.close(err => err ? reject(err) : resolve()),
                );
            }
            await database.sequelize.close();
            logger.info('All services stopped');
        } catch (e: any) {
            logger.error(`Shutdown error: ${e?.message ?? e}`);
        }
        log4js.shutdown(() => process.exit(0));
    }

    /** Build settings response with agents dynamically injected from directories */
    private settingsWithAgents() {
        const agents: Record<string, any> = {};
        for (const a of config.listAgents()) agents[a.id] = a;
        return { ...config.settings, agents };
    }

    async start() {
        const isDev = process.env.NODE_ENV === 'development';
        const port = isDev ? 5510 : config.getHttpPort();
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
        this.registerFilesystemRoutes(app);
        this.registerMcpRoutes(app);
        this.registerSkillRoutes(app);
        this.registerSkillHubRoutes(app);
        this.registerAgentStoreRoutes(app);
        this.registerPromptRoutes(app);
        this.registerDataRoutes(app);
        this.registerSchedulerRoutes(app);
        this.registerTodoRoutes(app);
        this.registerLogRoutes(app);
        this.registerUserRoutes(app);
        this.registerChatRoutes(app);

        // HTTP + WebSocket 服务
        const server = this.server = http.createServer(app);

        const wss = new WebSocketServer({ server, path: '/ws/chat' });
        wss.on('connection', (ws) => {
            this.wsClients.add(ws);
            ws.on('close', () => { this.wsClients.delete(ws); });
            ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(data.toString()) as { type?: string; [key: string]: any };
                    const sid = msg.sessionId as string | undefined;
                    if (!sid) throw new Error('sessionId is required');
                    const threadId = sessionThreadId(sid);
                    switch (msg.type) {
                        case WsCommandType.Query: {
                            const enriched = processMessage(msg.parts ?? [], msg.attachments, uploadDir);
                            if (isEmptyContent(enriched)) break;
                            sessionManager.onReceiveWebMessage(threadId, enriched, sid);
                            break;
                        }
                        case WsCommandType.Approval:
                        case WsCommandType.Ask:
                        case WsCommandType.Abort: {
                            sessionManager.onWebTriggerAction(threadId, msg.type!, msg).catch(e => logger.error(`ws trigger error: ${e?.message ?? e}`));
                            break;
                        }
                    }
                } catch (e: any) { 
                    logger.error(`ws message error: ${e?.message ?? e}`);
                }
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

        app.post('/api/shutdown', api(async () => {
            logger.info('Shutdown requested via API');
            // 先返回响应，再异步关闭服务
            setTimeout(() => this.shutdown(), 500);
            return { message: 'Shutting down...' };
        }));

        // 每日 token 用量（最近 30 天）
        app.get('/api/usage-stats', api(async () => {
            return database.findAll(database.usageStats, { order: [['date', 'DESC']], limit: 30 });
        }));

        // 按 threadId / sessionId 查询 token 用量
        app.get('/api/thread-usage', api(async req => {
            const threads = (req.query.threads as string || '').split(',').filter(Boolean);
            const sessions = (req.query.sessions as string || '').split(',').filter(Boolean);
            return database.loadThreadUsages(threads, sessions);
        }));
    }

    // ===== Settings =====
    private registerSettingsRoutes(app: express.Application) {
        app.get('/api/settings', api(() => this.settingsWithAgents()));

        app.put('/api/settings/general', api(req => {
            const { httpPort, httpUrl, lark, autoApproveTools, autoApproveAllTools, startupCommands } = req.body;
            if (httpPort !== undefined) config.settings.httpPort = httpPort || undefined;
            if (httpUrl !== undefined) config.settings.httpUrl = httpUrl || undefined;
            if (lark !== undefined) (config.settings as any).lark = lark;
            if (autoApproveTools !== undefined) config.settings.autoApproveTools = autoApproveTools;
            if (autoApproveAllTools !== undefined) config.settings.autoApproveAllTools = autoApproveAllTools;
            if (startupCommands !== undefined) config.settings.startupCommands = startupCommands;
            config.saveSettings();
            return config.settings;
        }));

        // Fetch available models from a provider's baseURL
        app.post('/api/models/available', api(async req => {
            const { baseURL, apiKey, provider, apiVersion } = req.body as { baseURL?: string; apiKey?: string; provider?: string; apiVersion?: string };

            if (provider === ModelProvider.Anthropic) {
                const base = (baseURL || 'https://api.anthropic.com').replace(/\/$/, '');
                if (!apiKey) throwBad('apiKey is required for Anthropic');
                try {
                    const headers: Record<string, string> = {
                        'x-api-key': apiKey,
                        'anthropic-version': '2023-06-01',
                    };
                    const res = await fetch(`${base}/v1/models`, { headers });
                    if (!res.ok) throw new Error(`${res.status}`);
                    const data: any = await res.json();
                    return (data.data as any[] || []).map((m: any) => m.id as string);
                } catch {
                    return getKnownModels(ModelProvider.Anthropic);
                }
            }

            if (provider === ModelProvider.Gemini || provider === ModelProvider.GeminiImage) {
                if (!apiKey) throwBad('apiKey is required for Gemini');
                const base = (baseURL || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
                try {
                    const headers: Record<string, string> = { 'x-goog-api-key': apiKey };
                    const ver = apiVersion || 'v1beta';
                    const res = await fetch(`${base}/${ver}/models`, { headers });
                    if (!res.ok) throw new Error(`${res.status}`);
                    const data: any = await res.json();
                    return (data.models as any[] || []).map((m: any) => (m.name as string).replace(/^models\//, ''));
                } catch {
                    const imageModels = getKnownModels(ModelProvider.GeminiImage);
                    const textModels = getKnownModels(ModelProvider.Gemini);
                    return provider === ModelProvider.GeminiImage
                        ? [...imageModels, ...textModels]
                        : [...textModels, ...imageModels];
                }
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

        registerSettingsCrud(app, 'models', {
            label: 'Model',
            afterSave: (id) => fetchAndSaveContextWindow(id).catch(() => {}),
        });
        registerSettingsCrud(app, 'embeddings', { label: 'Embedding' });
        registerSettingsCrud(app, 'savers', { label: 'Saver config' });
        registerSettingsCrud(app, 'memories', { label: 'Memory config' });
        registerSettingsCrud(app, 'wikis', { label: 'Wiki config' });
        this.registerAgentRoutes(app);
        registerSettingsCrud(app, 'channels', {
            label: 'Channel',
            checkOnUpdate: true,
            checkOnDelete: true,
            afterSave: (id) => channelManager.reloadChannel(id),
            createReturn: (id, body) => ({ id, ...body }),
        });
        app.get('/api/sessions', api(async req => {
            const workPath = req.query.workPath as string | undefined;
            const where: any = {};
            if (workPath) where.workPath = workPath;
            const rows = await database.findAll<SessionRow>(database.session, {
                where,
                order: [['createdAt', 'DESC']],
            });
            return rows.map(r => ({
                ...r,
                memories: parseMemories(r.memories),
                wikis: parseMemories(r.wikis),
            }));
        }));

        app.post('/api/settings/sessions', api(async req => {
            const id = randomUUID();
            const now = Date.now();
            const body = req.body;
            if (!body.agent) throwBad('agent is required');
            if (!body.saver) throwBad('saver is required');
            await database.create(database.session, {
                id,
                name: body.name ?? '',
                agent: body.agent,
                saver: body.saver,
                memories: body.memories ? JSON.stringify(body.memories) : null,
                wikis: body.wikis ? JSON.stringify(body.wikis) : null,
                workPath: body.workPath ?? null,
                createdAt: now,
            });
            return { id };
        }));

        app.put('/api/settings/sessions/:id', api(async req => {
            const id = req.params.id as string;
            const existing = await database.findByPk<SessionRow>(database.session, id);
            if (!existing) throwBad(`Session "${id}" not found`);
            const body = req.body;
            await database.update(database.session, {
                name: body.name ?? existing.name,
                agent: body.agent ?? existing.agent,
                saver: body.saver ?? existing.saver,
                memories: body.memories !== undefined ? (body.memories ? JSON.stringify(body.memories) : null) : existing.memories,
                wikis: body.wikis !== undefined ? (body.wikis ? JSON.stringify(body.wikis) : null) : existing.wikis,
                workPath: body.workPath !== undefined ? body.workPath : existing.workPath,
                autoApproveAllTools: body.autoApproveAllTools !== undefined ? !!body.autoApproveAllTools : existing.autoApproveAllTools,
            }, { where: { id } });
            return { id };
        }));

        app.delete('/api/settings/sessions/:id', api(async req => {
            const id = req.params.id as string;
            await database.destroy(database.session, { where: { id } });
            return { success: true };
        }));
    }

    // ===== Agents (directory-based CRUD) =====
    private registerAgentRoutes(app: express.Application) {
        // List all agents
        app.get('/api/agents', api(() => config.listAgents()));

        // Create agent
        app.post('/api/agents', api(req => {
            const body = req.body;
            const id = (body.id || '').trim();
            if (!id) throwBad('id is required');
            if (id !== sanitizeId(id)) throwBad(`Invalid id "${id}"`);
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
                return { name: s.name, description: s.description, source, dirName: path.basename(s.path) };
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

        app.get('/api/skills/:name/tree', api(req => {
            const name = req.params.name as string;
            const skill = globalSkillService.getAllSkills().find((s: any) => s.name === name);
            if (!skill) { const e: any = new Error(`Skill "${name}" not found`); e.status = 404; throw e; }
            return buildSkillTree(skill.path);
        }));

        app.get('/api/skills/:name/file', api(req => {
            const name = req.params.name as string;
            const skill = globalSkillService.getAllSkills().find((s: any) => s.name === name);
            if (!skill) { const e: any = new Error(`Skill "${name}" not found`); e.status = 404; throw e; }
            const filePath = safeSkillFilePath(req.query.path as string);
            const fullPath = path.join(skill.path, filePath);
            if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
                const e: any = new Error(`File "${filePath}" not found`); e.status = 404; throw e;
            }
            return { path: filePath, content: fs.readFileSync(fullPath, 'utf-8') };
        }));

        app.delete('/api/skills/:name', api(req => {
            const result = deleteSkill(config.getSkillsPath(), req.params.name as string);
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
                return { name: s.name, description: s.description, source, dirName: path.basename(s.path) };
            });
            return {
                globals,
                skills: listSkills(config.getAgentSkillsPath(agentName)).map((s: any) => ({ ...s, source: 'agent' })),
            };
        }));

        app.get('/api/agents/:name/skills/:skillName', api(req =>
            getSkill(config.getAgentSkillsPath(req.params.name as string), req.params.skillName as string)
        ));

        app.get('/api/agents/:name/skills/:skillName/tree', api(req => {
            const skillsDir = config.getAgentSkillsPath(req.params.name as string);
            const svc = new SkillService("", "", "", "");
            svc.registerSkillsDir(skillsDir);
            const skill = svc.getAllSkills().find(s => s.name === req.params.skillName);
            if (!skill) { const e: any = new Error(`Skill "${req.params.skillName}" not found`); e.status = 404; throw e; }
            return buildSkillTree(skill.path);
        }));

        app.get('/api/agents/:name/skills/:skillName/file', api(req => {
            const skillsDir = config.getAgentSkillsPath(req.params.name as string);
            const svc = new SkillService("", "", "", "");
            svc.registerSkillsDir(skillsDir);
            const skill = svc.getAllSkills().find(s => s.name === req.params.skillName);
            if (!skill) { const e: any = new Error(`Skill "${req.params.skillName}" not found`); e.status = 404; throw e; }
            const filePath = safeSkillFilePath(req.query.path as string);
            const fullPath = path.join(skill.path, filePath);
            if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
                const e: any = new Error(`File "${filePath}" not found`); e.status = 404; throw e;
            }
            return { path: filePath, content: fs.readFileSync(fullPath, 'utf-8') };
        }));

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
            const { url, overwrite = false }: { url: string; overwrite: boolean } = req.body;
            if (!url?.trim()) { const e: any = new Error('Missing url'); e.status = 400; throw e; }
            const result = await this.skillHubService.installSkill(url.trim(), config.getSkillsPath(), { overwrite });
            refreshGlobalSkillService();
            return result;
        }));

        // ── Agent Skill Hub ──
        app.post('/api/agents/:agentName/skill-hub/install', api(async req => {
            const agentName = req.params.agentName as string;
            const { url, overwrite = false }: { url: string; overwrite: boolean } = req.body;
            if (!url?.trim()) { const e: any = new Error('Missing url'); e.status = 400; throw e; }
            return await this.skillHubService.installSkill(url.trim(), config.getAgentSkillsPath(agentName), { overwrite });
        }));
    }

    // ===== Agent Store =====
    private registerAgentStoreRoutes(app: express.Application) {
        // ── Sources ──
        app.get('/api/agent-store/sources', api(() => {
            return this.agentStoreService.getSources();
        }));

        app.post('/api/agent-store/sources', api(async req => {
            const { url, name } = req.body;
            if (!url?.trim()) throwBad('Missing url');
            this.agentStoreService.addSource({ url: url.trim(), name });
            return this.agentStoreService.getSources();
        }));

        app.delete('/api/agent-store/sources/:index', api(async req => {
            const index = Number(req.params.index);
            if (isNaN(index)) throwBad('Invalid index');
            this.agentStoreService.removeSource(index);
            return this.agentStoreService.getSources();
        }));

        // ── Proxy (fetch remote JSON on behalf of frontend to avoid CORS) ──
        app.get('/api/agent-store/proxy', api(async req => {
            const url = req.query.url as string | undefined;
            if (!url?.trim()) throwBad('Missing url');
            return this.agentStoreService.fetchRemoteJson(url.trim());
        }));

        // ── Install ──
        app.post('/api/agent-store/install', api(async req => {
            const { pkg, overwrite = false, sourceUrl, localAgents, versionIndex }: {
                pkg: any; overwrite: boolean; sourceUrl?: string; localAgents?: any[]; versionIndex?: number;
            } = req.body;
            if (!pkg?.id) throwBad('Missing pkg.id');
            const result = await this.agentStoreService.install(pkg, overwrite, {
                versionIndex,
                sourceUrl,
                localAgents,
                skillHub: this.skillHubService,
            });
            return { ...result, settings: this.settingsWithAgents() };
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
        return items.map(({ message: { content, role, tool_calls, tool_call_id, name }, createdAt, thinkId }) => ({
            message: { role, content, tool_calls, tool_call_id, name },
            createdAt,
            thinkId,
        }));
    }

    private resolveMemoryThreadId(req: Request): string | undefined {
        const sessionId = req.query.sessionId as string | undefined;
        if (sessionId) return sessionThreadId(sessionId);
        return req.query.threadId as string | undefined;
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

        // ── Session-based saver shortcuts (resolve saverId + threadId from sessionId) ──
        const getSessionRow = async (sessionId: string): Promise<SessionRow> => {
            const row = await database.findByPk<SessionRow>(database.session, sessionId);
            if (!row?.saver) { const e: any = new Error(`Session "${sessionId}" not found or no saver`); e.status = 404; throw e; }
            return row;
        };

        app.get('/api/sessions/:sessionId/history', api(async req => {
            const sessionId = req.params.sessionId as string;
            const row = await getSessionRow(sessionId);
            const saver = await AgentRunner.createSaverService(row.saver, sessionThreadId(sessionId));
            const messages = await saver.getAllMessages();
            await saver.dispose();
            return this.formatMessages(messages);
        }));

        app.delete('/api/sessions/:sessionId/history', api(async req => {
            const sessionId = req.params.sessionId as string;
            const row = await getSessionRow(sessionId);
            const saver = await AgentRunner.createSaverService(row.saver, sessionThreadId(sessionId));
            await saver.clearMessages();
            await saver.dispose();
        }));

        app.get('/api/sessions/:sessionId/thinks/:thinkId', api(async req => {
            const sessionId = req.params.sessionId as string;
            const row = await getSessionRow(sessionId);
            const saver = await AgentRunner.createSaverService(row.saver, sessionThreadId(sessionId));
            const messages = await saver.getThink(req.params.thinkId as string);
            await saver.dispose();
            return this.formatMessages(messages);
        }));

        // ── Memories (accept ?sessionId= or ?threadId=) ──
        app.get('/api/memories/:memoryName', api(async req => {
            const threadId = this.resolveMemoryThreadId(req);
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
            const threadId = this.resolveMemoryThreadId(req);
            const svc = await AgentRunner.createMemoryService(req.params.memoryName as string, threadId);
            const ids = await svc.addMemoryDirect(content.trim(), { autoSplit });
            await svc.dispose();
            return { ids };
        }));

        app.post('/api/memories/:memoryName/compress', api(async req => {
            const threadId = this.resolveMemoryThreadId(req);
            const svc = await AgentRunner.createMemoryService(req.params.memoryName as string, threadId);
            const count = await svc.compressMemories();
            await svc.dispose();
            return { count };
        }));

        app.delete('/api/memories/:memoryName/:memoryId', api(async req => {
            const threadId = this.resolveMemoryThreadId(req);
            const svc = await AgentRunner.createMemoryService(req.params.memoryName as string, threadId);
            await svc.deleteMemory(req.params.memoryId as string);
            await svc.dispose();
        }));

        app.delete('/api/memories/:memoryName', api(async req => {
            const threadId = this.resolveMemoryThreadId(req);
            const svc = await AgentRunner.createMemoryService(req.params.memoryName as string, threadId);
            const count = await svc.clearAll();
            await svc.dispose();
            return { count };
        }));

        app.get('/api/memories/:memoryId/threads', api(async req => {
            return listThreadIds(config.getMemoryDBDir(req.params.memoryId as string), ".db");
        }));

        // ── Wiki ──
        app.get('/api/wikis/:wikiName', api(async req => {
            const threadId = this.resolveMemoryThreadId(req);
            const svc = await AgentRunner.createWikiService(req.params.wikiName as string, threadId);
            const pages = await svc.getAllPages();
            return pages.map((p: any) => ({
                id: p.id, title: p.title, tags: p.tags,
                source: p.source, version: p.version,
                createdAt: p.createdAt, updatedAt: p.updatedAt,
            }));
        }));

        app.get('/api/wikis/:wikiName/pages/:pageId', api(async req => {
            const threadId = this.resolveMemoryThreadId(req);
            const svc = await AgentRunner.createWikiService(req.params.wikiName as string, threadId);
            const page = await svc.getPage(req.params.pageId as string);
            if (!page) { const e: any = new Error('Page not found'); e.status = 404; throw e; }
            return page;
        }));

        app.post('/api/wikis/:wikiName/pages', api(async req => {
            const { title, content, tags } = req.body as { title?: string; content?: string; tags?: string[] };
            if (!title?.trim() || !content?.trim()) {
                const e: any = new Error('title and content are required'); e.status = 400; throw e;
            }
            const threadId = this.resolveMemoryThreadId(req);
            const svc = await AgentRunner.createWikiService(req.params.wikiName as string, threadId);
            return svc.createPage(title, content, tags);
        }));

        app.put('/api/wikis/:wikiName/pages/:pageId', api(async req => {
            const threadId = this.resolveMemoryThreadId(req);
            const svc = await AgentRunner.createWikiService(req.params.wikiName as string, threadId);
            return svc.updatePage(req.params.pageId as string, req.body);
        }));

        app.delete('/api/wikis/:wikiName/pages/:pageId', api(async req => {
            const threadId = this.resolveMemoryThreadId(req);
            const svc = await AgentRunner.createWikiService(req.params.wikiName as string, threadId);
            await svc.deletePage(req.params.pageId as string);
            return { ok: true };
        }));

        app.get('/api/wikis/:wikiName/search', api(async req => {
            const query = req.query.q as string;
            const limit = parseInt(req.query.limit as string) || 5;
            if (!query?.trim()) { const e: any = new Error('q parameter is required'); e.status = 400; throw e; }
            const threadId = this.resolveMemoryThreadId(req);
            const svc = await AgentRunner.createWikiService(req.params.wikiName as string, threadId);
            return svc.search(query, limit);
        }));

        app.get('/api/wikis/:wikiId/threads', api(async req => {
            return listSubDirs(config.getWikiDBDir(req.params.wikiId as string));
        }));
    }

    // ===== Schedulers =====
    private registerSchedulerRoutes(app: express.Application) {
        app.get('/api/schedulers', api(async () => {
            const schedulers = await database.findAll(database.scheduler, { where: { disabled: false } });
            return (schedulers as any[]).map(s => ({
                ...(s.toJSON ? s.toJSON() : s),
                nextRun: schedulerService.nextDate((s as any).id),
            }));
        }));

        app.delete('/api/schedulers/:id', api(async req => {
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) throwBad('Invalid id');
            await schedulerService.delete(id);
        }));
    }

    // ===== Todos =====
    private registerTodoRoutes(app: express.Application) {
        app.get('/api/todos', api(async () => {
            return await database.findAll<TodoRow>(database.todo, {
                where: { status: 'pending' },
                order: [['createdAt', 'DESC']],
            });
        }));

        app.patch('/api/todos/:id', api(async req => {
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) throwBad('Invalid id');
            const todo = await database.findByPk<TodoRow>(database.todo, id);
            if (!todo) throwBad('Todo not found');
            const now = Date.now();
            await database.update(database.todo, { status: 'done', doneAt: now }, { where: { id } });
            if (todo.schedulerId) {
                try { await schedulerService.delete(todo.schedulerId); } catch {}
            }
        }));

        app.delete('/api/todos/:id', api(async req => {
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) throwBad('Invalid id');
            const todo = await database.findByPk<TodoRow>(database.todo, id);
            if (!todo) throwBad('Todo not found');
            if (todo.schedulerId) {
                try { await schedulerService.delete(todo.schedulerId); } catch {}
            }
            await database.destroy(database.todo, { where: { id } });
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
            const { sessionName, agentId, memories, useChannelMemories, workPath, intentModel, intentPrompt, intentThreshold, streamVerbose, autoApproveAllTools } = req.body;
            await database.update(database.channelSession, { sessionName, agentId, memories: JSON.stringify(memories || []), useChannelMemories: !!useChannelMemories, workPath: workPath || null, intentModel: intentModel || null, intentPrompt: intentPrompt || null, intentThreshold: intentThreshold ?? 0.7, streamVerbose: !!streamVerbose, autoApproveAllTools: !!autoApproveAllTools }, { where: { id } });
        }));

        app.delete('/api/channel-sessions/:id', api(async req => {
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) { const e: any = new Error('Invalid id'); e.status = 400; throw e; }
            await database.destroy(database.channelSession, { where: { id } });
        }));

        // --- QR code login ---

        app.post('/api/channels/:id/qrcode/:key', api(async req => {
            const channelId = req.params.id as string;
            const key = req.params.key as string;
            const channel = channelManager.getChannel(channelId);
            if (!channel) throwBad(`Channel "${channelId}" not found`);

            const plugin = channelManager.getPlugin(channel.type);
            if (!plugin?.getQRCode) throwBad(`Plugin "${channel.type}" does not support QR code login`);

            const qrcode = await plugin.getQRCode(key, req.body);
            return qrcode;
        }));

        app.post('/api/channels/:id/qrcode/:key/confirm', api(async req => {
            const channelId = req.params.id as string;
            const key = req.params.key as string;
            const channel = channelManager.getChannel(channelId);
            if (!channel) throwBad(`Channel "${channelId}" not found`);

            const plugin = channelManager.getPlugin(channel.type);
            if (!plugin?.awaitQRResult) throwBad(`Plugin "${channel.type}" does not support QR code login`);

            const credentials = await plugin.awaitQRResult(key);
            if (!credentials) return { status: "expired" };

            // Persist credentials under config[key]
            const cfg = channel.config ?? {};
            cfg[key] = credentials;
            channel.config = cfg;
            config.saveSettings();

            // Reload the channel so it picks up the new credentials
            await channelManager.reloadChannel(channelId);

            return { status: "confirmed", credentials };
        }));
    }

    // ===== Logs =====
    private registerLogRoutes(app: express.Application) {
        const logsDir = config.getConfigPath('logs', true);

        // 列出日志文件
        app.get('/api/logs', api(async () => {
            const files = await fs.promises.readdir(logsDir);
            return files
                .filter(f => f.endsWith('.log'))
                .sort()
                .reverse();
        }));

        // 读取指定日志文件内容（支持 tail 行数）
        app.get('/api/logs/:filename', api(async req => {
            const filename = req.params.filename as string;
            if (!filename.endsWith('.log') || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
                throwBad('Invalid filename');
            }
            const filepath = path.join(logsDir, filename);
            if (!fs.existsSync(filepath)) throwBad('File not found');

            const tail = parseInt(req.query.tail as string || '', 10);
            const level = ((req.query.level as string) || '').toUpperCase();
            const keyword = (req.query.keyword as string) || '';

            const content = await fs.promises.readFile(filepath, 'utf-8');
            let lines = content.split('\n');

            if (level) {
                lines = lines.filter(l => l.includes(`[${level}]`));
            }
            if (keyword) {
                const kw = keyword.toLowerCase();
                lines = lines.filter(l => l.toLowerCase().includes(kw));
            }
            if (tail > 0) {
                lines = lines.slice(-tail);
            }
            return { filename, lines };
        }));
    }

    // ===== Chat =====
    private registerChatRoutes(app: express.Application) {
        app.get('/api/session-status', (req, res) => {
            const { sessionId } = req.query as { sessionId?: string };
            if (!sessionId) { res.status(400).json({ error: 'sessionId is required' }); return; }
            const threadId = sessionThreadId(sessionId);
            const info = sessionManager.getInfo(threadId);
            if (!info) { res.json(null); return; }
            res.json(info);
        });

    }
}

export const httpServer = new HttpServer();
