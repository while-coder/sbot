import express, { Request, Response } from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import fsp from 'fs/promises';
import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import { AgentToolService, SkillService, ModelProvider, listThreadIds, setMaxImageSize, type StoredMessage } from "scorpio.ai";
import { config, isDev, isValidAgentId } from '../Core/Config';
import { AgentRunner } from '../Agent/AgentRunner';
import { ACPAgentPool } from '../Agent/ACPAgentPool';
import { globalAgentToolService, refreshGlobalAgentToolService, refreshBuiltinTools, BuiltinProvider } from '../Agent/GlobalAgentToolService';
import { globalSkillService, refreshGlobalSkillService, getSkillsDirsMap } from '../Agent/GlobalSkillService';
import { SkillHubService } from '../SkillHub';
import { installSkillFromZip } from '../SkillHub/bundle';
import axios from 'axios';
import { AgentStoreService } from '../AgentStore';
import { LoggerService, log4js } from '../Core/LoggerService';
import { database, parseMemories, getChannelSession, getSessionProfile, getEffectiveSession, ensureChannelSession, type ChannelSessionRow, type SessionProfileRow, type UsageLogRow } from '../Core/Database';
import { Op } from 'sequelize';
import { sessionManager } from '../Session/SessionManager';
import { schedulerService } from '../Scheduler/SchedulerService';
import { heartbeatService } from '../Heartbeat/HeartbeatService';
import { channelManager } from '../Channel/ChannelManager';
import { WEB_CHANNEL_ID } from 'sbot.commons';
import { getModelMeta, getKnownModels } from './modelCatalog';
import { FsApi } from './FsApi';
import { webService } from '../Channel/web/WebService';

const logger = LoggerService.getLogger('HttpServer.ts');
const execFileAsync = promisify(execFile);
const fsApi = new FsApi();

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
            const ver = mc.gemini?.apiVersion || 'v1beta';
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

/** 资源管理器 / 文件读取最大字节数 */
const MAX_FILE_READ_SIZE = 10 * 1024 * 1024;

/** 目录优先、再按名称排序 */
function dirFirstByName(a: { isDirectory(): boolean; name: string }, b: { isDirectory(): boolean; name: string }) {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
}

/**
 * 解析用户传入路径并校验为存在的目录。返回 stat 一并避免重复 syscall。
 * 路径不存在或不是目录时抛 400。
 */
function resolveExistingDir(input: string): { target: string; stat: fs.Stats } {
    const target = path.resolve(input);
    let stat: fs.Stats;
    try { stat = fs.statSync(target); }
    catch { throwBad(`Path does not exist: ${target}`); }
    if (!stat.isDirectory()) throwBad(`Path does not exist: ${target}`);
    return { target, stat };
}

/**
 * 安全相对路径校验：拒绝绝对路径与 .. 越界。供 prompts/skills 等需要拼接基准目录的接口使用。
 */
function safeRelPath(relPath: string | undefined): string {
    if (!relPath?.trim()) throwBad('path is required');
    const normalized = path.normalize(relPath.trim()).replace(/\\/g, '/');
    if (normalized.startsWith('..') || path.isAbsolute(normalized)) throwBad('Invalid path');
    return normalized;
}

function isPathInside(base: string, target: string): boolean {
    const rel = path.relative(base, target);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

async function runGit(cwd: string, args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 10000,
        maxBuffer: 30 * 1024 * 1024,
    });
    return String(stdout);
}

async function resolveGitRoot(dir: string): Promise<string | null> {
    try {
        const root = (await runGit(dir, ['rev-parse', '--show-toplevel'])).trim();
        return root ? path.resolve(root) : null;
    } catch {
        return null;
    }
}

function parseGitStatus(output: string) {
    const records = output.split('\0').filter(Boolean);
    const items: {
        path: string;
        oldPath?: string;
        status: string;
        staged: boolean;
        unstaged: boolean;
        untracked: boolean;
    }[] = [];

    for (let i = 0; i < records.length; i++) {
        const rec = records[i];
        if (rec.length < 4) continue;

        const x = rec[0] ?? ' ';
        const y = rec[1] ?? ' ';
        const status = `${x}${y}`;
        const itemPath = rec.slice(3);
        let oldPath: string | undefined;

        if ((x === 'R' || x === 'C' || y === 'R' || y === 'C') && i + 1 < records.length) {
            oldPath = records[++i];
        }

        items.push({
            path: itemPath,
            oldPath,
            status,
            staged: x !== ' ' && x !== '?' && x !== '!',
            unstaged: y !== ' ' && y !== '!',
            untracked: status === '??',
        });
    }

    return items;
}

async function mutateTodoFile(filePath: string, mutator: (data: any) => void): Promise<void> {
    const buf = await fsp.readFile(filePath, 'utf-8').catch(() => '{"todos":[],"nextId":1}');
    const data = JSON.parse(buf);
    if (!Array.isArray(data.todos)) data.todos = [];
    if (typeof data.nextId !== 'number') data.nextId = 1;
    mutator(data);
    const tmp = `${filePath}.tmp`;
    try {
        await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
        await fsp.rename(tmp, filePath);
    } catch (e) {
        await fsp.unlink(tmp).catch(() => {});
        throw e;
    }
}

/** 注册标准 Settings CRUD 路由 (POST/PUT/DELETE) */
function registerSettingsCrud(
    app: express.Application,
    section: string,
    opts?: {
        label?: string;
        checkOnUpdate?: boolean;
        checkOnDelete?: boolean;
        beforeDelete?: (id: string) => void;
        afterDelete?: (id: string) => Promise<void> | void;
        afterSave?: (id: string) => Promise<void> | void;
        createReturn?: (id: string, body: any) => any;
        getSettings?: () => any;
    },
) {
    const label = opts?.label ?? section.charAt(0).toUpperCase() + section.slice(1, -1);
    const checkOnUpdate = opts?.checkOnUpdate ?? true;
    const checkOnDelete = opts?.checkOnDelete ?? false;
    const getSettings = opts?.getSettings ?? (() => config.settings);
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
        return opts?.createReturn ? opts.createReturn(id, req.body) : getSettings();
    }));

    app.put(`/api/settings/${section}/:id`, api(async req => {
        const id = req.params.id as string;
        const map = getSection();
        if (checkOnUpdate && !map[id]) throwBad(`${label} "${id}" not found`);
        map[id] = req.body;
        config.saveSettings();
        await opts?.afterSave?.(id);
        return opts?.createReturn ? opts.createReturn(id, req.body) : getSettings();
    }));

    app.delete(`/api/settings/${section}/:id`, api(async req => {
        const id = req.params.id as string;
        opts?.beforeDelete?.(id);
        const map = getSection();
        if (checkOnDelete && !map[id]) throwBad(`${label} "${id}" not found`);
        delete map[id];
        config.saveSettings();
        await opts?.afterDelete?.(id);
        await opts?.afterSave?.(id);
        return getSettings();
    }));
}

// ===== Prompts =====
import { loadPromptMeta, type PromptVarMeta } from '../Core/PromptLoader';

const PROMPTS_DIR = path.resolve(__dirname, '../../prompts');

type PromptNode = { name: string; type: 'file' | 'dir'; path: string; isOverride?: boolean; isUserOnly?: boolean; children?: PromptNode[] };

function buildPromptTree(dir: string, basePath = '', userBaseDir = ''): PromptNode[] {
    if (!fs.existsSync(dir)) return [];
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort(dirFirstByName);
    const result: PromptNode[] = [];
    const seen = new Set<string>();
    for (const entry of entries) {
        const relPath = basePath ? `${basePath}/${entry.name}` : entry.name;
        seen.add(entry.name);
        if (entry.isDirectory()) {
            const children = buildPromptTree(path.join(dir, entry.name), relPath, userBaseDir);
            const anyOverride = children.some(c => c.isOverride || c.isUserOnly || c.children?.some(cc => cc.isOverride || cc.isUserOnly));
            result.push({ name: entry.name, type: 'dir', path: relPath, isOverride: anyOverride, children });
        } else if (entry.isFile()) {
            const isOverride = userBaseDir ? fs.existsSync(path.join(userBaseDir, relPath)) : false;
            result.push({ name: entry.name, type: 'file', path: relPath, isOverride });
        }
    }
    if (userBaseDir) {
        const userDir = basePath ? path.join(userBaseDir, basePath) : userBaseDir;
        if (fs.existsSync(userDir)) {
            const userEntries = fs.readdirSync(userDir, { withFileTypes: true })
                .filter(e => !seen.has(e.name))
                .sort(dirFirstByName);
            for (const entry of userEntries) {
                const relPath = basePath ? `${basePath}/${entry.name}` : entry.name;
                if (entry.isDirectory()) {
                    const children = buildPromptTree(path.join(userDir, entry.name), relPath, userBaseDir);
                    result.push({ name: entry.name, type: 'dir', path: relPath, isUserOnly: true, children });
                } else if (entry.isFile()) {
                    result.push({ name: entry.name, type: 'file', path: relPath, isUserOnly: true });
                }
            }
        }
    }
    return result;
}

// ===== Skills 辅助函数 =====
function listSkills(skillsDir: string) {
    if (!fs.existsSync(skillsDir)) return [];
    const svc = new SkillService("", "", "", "");
    svc.registerSkillsDir(skillsDir);
    return svc.getAllSkills().map(s => ({
        path: s.path,
        name: s.name,
        description: s.description,
        dirName: path.basename(s.path),
    }));
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

function parseRangeQuery(req: Request): { offset?: number; limit?: number } {
    const offset = req.query.offset != null ? Number(req.query.offset) : undefined;
    const limit = req.query.limit != null ? Number(req.query.limit) : undefined;
    return {
        offset: Number.isFinite(offset as number) ? offset : undefined,
        limit: Number.isFinite(limit as number) ? limit : undefined,
    };
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
    private server?: http.Server;

    async shutdown(): Promise<void> {
        logger.info('Shutting down services...');
        try {
            schedulerService.stopAll();
            await ACPAgentPool.getInstance().disposeAll();
            await channelManager.dispose();
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
        this.registerHeartbeatRoutes(app);
        this.registerTodoRoutes(app);
        this.registerLogRoutes(app);
        this.registerUserRoutes(app);
        this.registerChatRoutes(app);

        // HTTP + WebSocket 服务：把 ws 升级路径与 web channel 运行时交给 WebService，
        // 然后注册到 channelManager，让消息出路与 dispose 生命周期与其他 channel 对齐
        const server = this.server = http.createServer(app);
        webService.attach(server, uploadDir);
        channelManager.registerService(WEB_CHANNEL_ID, webService);

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

        app.get('/api/proxy', api(async (req, res) => {
            const url = req.query.url as string | undefined;
            if (!url?.trim()) throwBad('Missing url');
            const upstream = await axios.get(url.trim(), { responseType: 'stream', timeout: 15000 });
            const headers = upstream.headers;
            if (headers['content-type']) res.setHeader('Content-Type', String(headers['content-type']));
            if (headers['content-length']) res.setHeader('Content-Length', String(headers['content-length']));
            res.status(upstream.status);
            upstream.data.pipe(res);
        }));

        app.get('/api/usage-stats', api(async (req) => {
            const today = new Date().toISOString().slice(0, 10);
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            const start = (req.query.start as string) || thirtyDaysAgo.toISOString().slice(0, 10);
            const end = (req.query.end as string) || today;
            const agentId = req.query.agentId as string | undefined;
            const modelId = req.query.modelId as string | undefined;

            const where: any = { date: { [Op.between]: [start, end] } };
            if (agentId) where.agentId = agentId;
            if (modelId) where.modelId = modelId;

            const rows = await database.findAll<UsageLogRow>(database.usageLogs, {
                where,
                order: [['date', 'ASC']],
            });

            const dailyMap = new Map<string, { date: string; inputTokens: number; outputTokens: number; totalTokens: number; cacheCreationTokens: number; cacheReadTokens: number }>();
            const summary = { totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };

            for (const r of rows) {
                summary.totalTokens += r.totalTokens;
                summary.inputTokens += r.inputTokens;
                summary.outputTokens += r.outputTokens;
                summary.cacheCreationTokens += r.cacheCreationTokens;
                summary.cacheReadTokens += r.cacheReadTokens;

                let day = dailyMap.get(r.date);
                if (!day) {
                    day = { date: r.date, inputTokens: 0, outputTokens: 0, totalTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
                    dailyMap.set(r.date, day);
                }
                day.inputTokens += r.inputTokens;
                day.outputTokens += r.outputTokens;
                day.totalTokens += r.totalTokens;
                day.cacheCreationTokens += r.cacheCreationTokens;
                day.cacheReadTokens += r.cacheReadTokens;
            }

            return { summary, daily: Array.from(dailyMap.values()) };
        }));

        // 按 threadId 或 sessionId 查询 token 用量（统计存在 profile，按 session.profileId 反查）
        app.get('/api/thread-usage', api(async req => {
            const threads = (req.query.threads as string || '').split(',').filter(Boolean);
            const sessions = (req.query.sessions as string || '').split(',').filter(Boolean);
            const result: Record<string, any> = {};
            if (threads.length > 0) Object.assign(result, await database.loadThreadUsages(threads));
            for (const sid of sessions) {
                const row = await database.findOne<ChannelSessionRow>(database.channelSession, { where: { channelId: WEB_CHANNEL_ID, sessionId: sid } });
                if (!row) continue;
                const profile = await getSessionProfile(row.profileId);
                if (profile) result[sid] = { inputTokens: profile.inputTokens, outputTokens: profile.outputTokens, totalTokens: profile.totalTokens, lastInputTokens: profile.lastInputTokens, lastOutputTokens: profile.lastOutputTokens, lastTotalTokens: profile.lastTotalTokens };
            }
            return result;
        }));
    }

    // ===== Settings =====
    private registerSettingsRoutes(app: express.Application) {
        app.get('/api/settings', api(() => this.settingsWithAgents()));

        app.put('/api/settings/general', api(req => {
            const { httpPort, httpUrl, maxImageSize, autoApproveTools, autoApproveAllTools, startupCommands } = req.body;
            if (httpPort !== undefined) config.settings.httpPort = httpPort || undefined;
            if (httpUrl !== undefined) config.settings.httpUrl = httpUrl || undefined;
            if (maxImageSize !== undefined) {
                config.settings.maxImageSize = maxImageSize || undefined;
                setMaxImageSize(config.settings.maxImageSize);
            }
            if (autoApproveTools !== undefined) config.settings.autoApproveTools = autoApproveTools;
            if (autoApproveAllTools !== undefined) config.settings.autoApproveAllTools = autoApproveAllTools;
            if (startupCommands !== undefined) config.settings.startupCommands = startupCommands;
            config.saveSettings();
            return this.settingsWithAgents();
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

        const getSettings = () => this.settingsWithAgents();
        registerSettingsCrud(app, 'models', {
            label: 'Model',
            afterSave: (id) => fetchAndSaveContextWindow(id).catch(() => {}),
            getSettings,
        });
        registerSettingsCrud(app, 'embeddings', { label: 'Embedding', getSettings });
        registerSettingsCrud(app, 'savers', { label: 'Saver config', getSettings });
        registerSettingsCrud(app, 'memories', { label: 'Memory config', getSettings });
        registerSettingsCrud(app, 'wikis', { label: 'Wiki config', getSettings });
        // heartbeats 已迁移到独立数据库表，CRUD 在 registerHeartbeatRoutes 中
        this.registerAgentRoutes(app);
        this.registerACPRoutes(app);
        registerSettingsCrud(app, 'channels', {
            label: 'Channel',
            checkOnUpdate: true,
            checkOnDelete: true,
            beforeDelete: (id) => { if (id === WEB_CHANNEL_ID) throwBad('Cannot delete built-in web channel'); },
            afterDelete: async (id) => {
                const sessions = await database.findAll<ChannelSessionRow>(database.channelSession, { where: { channelId: id } });
                const sessionIds = sessions.map(s => s.id);
                if (sessionIds.length > 0) {
                    await database.destroy(database.heartbeat, { where: { target: sessionIds } });
                }
                await database.destroy(database.channelSession, { where: { channelId: id } });
                await database.destroy(database.channelUser, { where: { channelId: id } });
                await heartbeatService.reloadAll();
                channelManager.reloadChannel(id);
            },
            afterSave: (id) => channelManager.reloadChannel(id),
            createReturn: (id, body) => ({ id, ...body }),
            getSettings,
        });
        app.get('/api/sessions', api(async () => {
            const rows = await database.findAll<ChannelSessionRow>(database.channelSession, {
                where: { channelId: WEB_CHANNEL_ID },
                order: [['createdAt', 'DESC']],
            });
            const result: any[] = [];
            for (const r of rows) {
                const profile = await getSessionProfile(r.profileId);
                result.push({
                    id: r.sessionId,
                    name: r.sessionName || r.autoSessionName,
                    agent: profile?.agentId || '',
                    saver: profile?.saver || '',
                    memories: parseMemories(profile?.memories ?? null),
                    wikis: parseMemories(profile?.wikis ?? null),
                    workPath: profile?.workPath || undefined,
                    autoApproveAllTools: profile?.autoApproveAllTools || undefined,
                });
            }
            return result;
        }));

        app.post('/api/settings/sessions', api(async req => {
            const body = req.body;
            const sid = randomUUID();
            const { profile } = await ensureChannelSession(WEB_CHANNEL_ID, sid, {
                sessionName: body.name ?? '',
            });
            await database.update(database.sessionProfile, {
                agentId: body.agent || null,
                saver: body.saver || null,
                memories: body.memories ? JSON.stringify(body.memories) : null,
                wikis: body.wikis ? JSON.stringify(body.wikis) : null,
                workPath: body.workPath ?? null,
            }, { where: { id: profile.id } });
            return { id: sid };
        }));

        app.put('/api/settings/sessions/:id', api(async req => {
            const sessionId = req.params.id as string;
            const existing = await database.findOne<ChannelSessionRow>(database.channelSession, { where: { channelId: WEB_CHANNEL_ID, sessionId } });
            if (!existing) throwBad(`Session "${sessionId}" not found`);
            const body = req.body;
            // sessionName 写 session；其他配置字段写 profile
            if (body.name !== undefined) {
                await database.update(database.channelSession, { sessionName: body.name }, { where: { channelId: WEB_CHANNEL_ID, sessionId } });
            }
            const profile = await getSessionProfile(existing!.profileId);
            if (!profile) throwBad(`Session "${sessionId}" has no associated profile`);
            const profileUpdate: Record<string, any> = {};
            if (body.agent !== undefined) profileUpdate.agentId = body.agent || null;
            if (body.saver !== undefined) profileUpdate.saver = body.saver || null;
            if (body.memories !== undefined) profileUpdate.memories = body.memories ? JSON.stringify(body.memories) : null;
            if (body.wikis !== undefined) profileUpdate.wikis = body.wikis ? JSON.stringify(body.wikis) : null;
            if (body.workPath !== undefined) profileUpdate.workPath = body.workPath;
            if (body.autoApproveAllTools !== undefined) profileUpdate.autoApproveAllTools = !!body.autoApproveAllTools;
            if (Object.keys(profileUpdate).length > 0) {
                await database.update(database.sessionProfile, profileUpdate, { where: { id: profile!.id } });
            }
            return { id: sessionId };
        }));

        app.delete('/api/settings/sessions/:id', api(async req => {
            const sessionId = req.params.id as string;
            await database.destroy(database.channelSession, { where: { channelId: WEB_CHANNEL_ID, sessionId } });
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
            if (!isValidAgentId(id)) throwBad(`Invalid id "${id}"`);
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

    // ===== ACP Process Pool =====
    private registerACPRoutes(app: express.Application) {
        app.get('/api/acp-sessions', api(() => ACPAgentPool.getInstance().list()));

        app.delete('/api/acp-sessions/:key', api(async req => {
            const key = decodeURIComponent(req.params.key as string);
            await ACPAgentPool.getInstance().release(key);
            return { success: true };
        }));

        app.delete('/api/acp-sessions', api(async () => {
            await ACPAgentPool.getInstance().disposeAll();
            return { success: true };
        }));
    }

    // ===== Filesystem =====
    private registerFilesystemRoutes(app: express.Application) {
        app.get('/api/fs/list', api(req => fsApi.listDir(req.query.path as string | undefined)));

        app.get('/api/fs/quickdirs', api(() => fsApi.quickDirs()));

        app.get('/api/fs/drives', api(() => fsApi.listDrives()));

        app.post('/api/fs/mkdir', api(req => fsApi.mkdir((req.body || {}).path)));

        app.post('/api/fs/entry', api(req => {
            const { path: filePath, content } = req.body || {};
            return fsApi.createFile(filePath, content ?? '');
        }));

        app.put('/api/fs/entry', express.json({ limit: '2mb' }), api(req => {
            const { path: filePath, content, expectedMtime } = req.body || {};
            return fsApi.writeFile(filePath, content ?? '', { expectedMtime });
        }));

        app.get('/api/fs/entry', api(req => {
            const filePath = req.query.path as string | undefined;
            const entryType = (req.query.type as string | undefined) || '';
            const recursive = req.query.recursive === '1' || req.query.recursive === 'true';
            if (entryType === 'tree') return fsApi.listTree(filePath, recursive);
            if (entryType === 'read') {
                return fsApi.readFile(filePath, {
                    ...parseRangeQuery(req),
                    chunk: req.query.offset != null || req.query.limit != null,
                });
            }
            throwBad('type must be "tree" or "read"');
        }));

        // 资源管理器：直接下载文件原始内容
        app.get('/api/fs/entry/raw', (req, res) => {
            try {
                const filePath = req.query.path as string | undefined;
                const { path: target } = fsApi.resolve(filePath);
                if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
                    res.status(404).json({ ok: false, message: `File not found: ${target}` });
                    return;
                }
                const fileName = path.basename(target);
                const encoded = encodeURIComponent(fileName);
                res.setHeader(
                    'Content-Disposition',
                    `inline; filename="${fileName.replace(/"/g, '\\"')}"; filename*=UTF-8''${encoded}`,
                );
                res.sendFile(path.resolve(target), { dotfiles: 'allow' });
            } catch (e: any) {
                res.status(e?.status ?? 404).json({ ok: false, message: e?.message ?? 'not found' });
            }
        });

        app.get('/api/git/status', api(async req => {
            const root = (req.query.root as string) ?? '';
            if (!root.trim()) throwBad('root is required');
            const { target } = resolveExistingDir(root.trim());
            const gitRoot = await resolveGitRoot(target);
            if (!gitRoot) return { root: target, items: [] };

            const stdout = await runGit(gitRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
            let branch = (await runGit(gitRoot, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => '')).trim();
            if (branch === 'HEAD') {
                const short = (await runGit(gitRoot, ['rev-parse', '--short', 'HEAD']).catch(() => '')).trim();
                branch = short ? `detached:${short}` : branch;
            }
            return { root: gitRoot, branch, items: parseGitStatus(stdout) };
        }));

        app.get('/api/git/diff', api(async req => {
            const root = (req.query.root as string) ?? '';
            const rel = (req.query.path as string) ?? '';
            const full = req.query.full === '1' || req.query.full === 'true';
            if (!root.trim()) throwBad('root is required');
            const { target } = resolveExistingDir(root.trim());
            const gitRoot = await resolveGitRoot(target);
            if (!gitRoot) return { root: target, path: rel, diff: '' };

            const relPath = safeRelPath(rel);
            const absPath = path.resolve(gitRoot, relPath);
            if (!isPathInside(gitRoot, absPath)) throwBad('Invalid path');

            const diffArgs = ['diff', '--no-ext-diff', '--text', '--find-renames'];
            if (full) diffArgs.push('--unified=999999');
            diffArgs.push('HEAD', '--', relPath);
            let diff = await runGit(gitRoot, diffArgs);
            if (!diff.trim()) {
                const isTracked = await runGit(gitRoot, ['ls-files', '--error-unmatch', '--', relPath])
                    .then(() => true)
                    .catch(() => false);

                if (!isTracked && fs.existsSync(absPath)) {
                    const stat = fs.statSync(absPath);
                    if (stat.isFile() && stat.size <= MAX_FILE_READ_SIZE) {
                        const buf = fs.readFileSync(absPath);
                        diff = `Untracked file: ${relPath}\n\n${buf.includes(0) ? '[binary file]' : buf.toString('utf-8')}`;
                    } else if (stat.isFile()) {
                        diff = `Untracked file: ${relPath}\n\n[file too large: ${stat.size} bytes]`;
                    }
                }
            }

            return { root: gitRoot, path: relPath, diff };
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
                skills: listSkills(config.getAgentSkillsPath(agentName)).map((s: any) => ({ ...s, source: 'agent' })),
            };
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
            return await this.skillHubService.installSkill(url.trim(), config.getAgentSkillsPath(agentName), { overwrite });
        }));

        app.post('/api/agents/:agentName/skill-hub/install-zip', express.raw({ type: 'application/zip', limit: '20mb' }), api(async req => {
            const agentName = req.params.agentName as string;
            const overwrite = req.query.overwrite === 'true';
            const buf = req.body as Buffer;
            if (!buf?.length) { const e: any = new Error('Missing zip body'); e.status = 400; throw e; }
            return installSkillFromZip(buf, config.getAgentSkillsPath(agentName), overwrite);
        }));
    }

    // ===== Agent Store =====
    private registerAgentStoreRoutes(app: express.Application) {
        app.get('/api/agent-store/list', api(() => {
            return this.agentStoreService.getSources();
        }));

        app.post('/api/agent-store/add', api(async req => {
            const { url, name } = req.body;
            if (!url?.trim()) throwBad('Missing url');
            this.agentStoreService.addSource({ url: url.trim(), name });
            return this.agentStoreService.getSources();
        }));

        app.post('/api/agent-store/remove', api(async req => {
            const { index } = req.body;
            if (index == null || isNaN(Number(index))) throwBad('Invalid index');
            this.agentStoreService.removeSource(Number(index));
            return this.agentStoreService.getSources();
        }));

        app.post('/api/agent-store/install', api(async req => {
            const { pkg, version, overwrite = false } = req.body;
            if (!pkg?.id) throwBad('Missing pkg.id');
            if (!version) throwBad('Missing version');
            const result = await this.agentStoreService.install(pkg, version, overwrite);
            return { ...result, settings: this.settingsWithAgents() };
        }));

        app.get('/api/agent-store/export', api(req => {
            const id = req.query.id as string | undefined;
            if (!id?.trim()) throwBad('Missing id');
            return this.agentStoreService.export(id.trim());
        }));

    }

    // ===== Prompts =====
    private registerPromptRoutes(app: express.Application) {
        app.get('/api/prompts/tree', api(() => {
            const userBaseDir = config.getConfigPath('prompts', true);
            return buildPromptTree(PROMPTS_DIR, '', userBaseDir);
        }));

        app.get('/api/prompts/files', api(req => {
            const prefix = (req.query.prefix as string || '').replace(/\\/g, '/').replace(/\/$/, '');
            const userBaseDir = config.getConfigPath('prompts', true);
            const tree = buildPromptTree(PROMPTS_DIR, '', userBaseDir);
            function flatten(nodes: PromptNode[]): { path: string; isUserOnly?: boolean }[] {
                const out: { path: string; isUserOnly?: boolean }[] = [];
                for (const n of nodes) {
                    if (n.type === 'file') out.push({ path: n.path, ...(n.isUserOnly ? { isUserOnly: true } : {}) });
                    else if (n.children) out.push(...flatten(n.children));
                }
                return out;
            }
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
            const defaultPath = path.join(PROMPTS_DIR, relPath);
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

    // ===== Data (Savers & Memories) =====
    private formatMessages(items: StoredMessage[]) {
        return items.map(({ id, message: { content, role, tool_calls, tool_call_id, name }, createdAt, thinkId, taskId, kind }) => ({
            id,
            message: { role, content, tool_calls, tool_call_id, name },
            createdAt,
            thinkId,
            taskId,
            kind,
        }));
    }


    private registerDataRoutes(app: express.Application) {
        // ── Savers / Threads ──
        app.get('/api/savers/:saverId/threads', api(async req =>
            listThreadIds(config.getSaverDBPath(req.params.saverId as string), ".db", ".json")
        ));

        // ── Saver/thread 公共助手：自动 dispose ──
        type SaverFn<T> = (saver: Awaited<ReturnType<typeof AgentRunner.createSaverService>>) => Promise<T>;
        const withSaver = async <T>(saverId: string, threadId: string, fn: SaverFn<T>): Promise<T> => {
            const saver = await AgentRunner.createSaverService(saverId, threadId);
            try { return await fn(saver); }
            finally { await saver.dispose(); }
        };

        // ── Channel session 解析 ──
        const resolveSessionSaver = async (row: ChannelSessionRow): Promise<{ saverId: string; threadId: string }> => {
            const profile = await getSessionProfile(row.profileId);
            const saverId = profile?.saver || config.getChannel(row.channelId)?.saver;
            if (!saverId) throwBad(`Session id=${row.id} has no saver configured`);
            const threadId = profile ? String(profile.id) : row.sessionId;
            return { saverId: saverId!, threadId };
        };

        const getSessionRowByPk = async (id: string): Promise<ChannelSessionRow> => {
            const row = await getChannelSession(id);
            if (!row) { const e: any = new Error(`channel_session id=${id} not found`); e.status = 404; throw e; }
            return row;
        };

        const getWebSessionRow = async (sessionId: string): Promise<ChannelSessionRow> => {
            const row = await database.findOne<ChannelSessionRow>(database.channelSession, { where: { channelId: WEB_CHANNEL_ID, sessionId } });
            if (!row) { const e: any = new Error(`Session "${sessionId}" not found`); e.status = 404; throw e; }
            return row;
        };

        // ── 注册 history+thinks 三件套 ──
        type SaverResolver = (req: Request) => Promise<{ saverId: string; threadId: string }> | { saverId: string; threadId: string };
        const registerSaverThreadRoutes = (basePath: string, resolve: SaverResolver) => {
            app.get(`${basePath}/history`, api(async req => {
                const { saverId, threadId } = await resolve(req);
                return withSaver(saverId, threadId, async s => this.formatMessages(await s.getAllMessages(true)));
            }));
            app.delete(`${basePath}/history`, api(async req => {
                const { saverId, threadId } = await resolve(req);
                await withSaver(saverId, threadId, s => s.clearMessages());
            }));
            app.get(`${basePath}/thinks/:thinkId`, api(async req => {
                const { saverId, threadId } = await resolve(req);
                return withSaver(saverId, threadId, async s => this.formatMessages(await s.getThink(req.params.thinkId as string)));
            }));
            app.get(`${basePath}/tasks/:taskId`, api(async req => {
                const { saverId, threadId } = await resolve(req);
                const taskId = req.params.taskId as string;
                const includeAll = req.query.includeAll === '1' || req.query.includeAll === 'true';
                return withSaver(saverId, threadId, async s => this.formatMessages(await s.getTaskMessages(taskId, includeAll)));
            }));
        };

        registerSaverThreadRoutes('/api/savers/:saverId/threads/:threadId', req => ({
            saverId: req.params.saverId as string,
            threadId: req.params.threadId as string,
        }));
        registerSaverThreadRoutes('/api/channel-sessions/:id', async req =>
            await resolveSessionSaver(await getSessionRowByPk(req.params.id as string))
        );
        // Legacy compat: /api/sessions/:sessionId/* (web channel UUID-based)
        registerSaverThreadRoutes('/api/sessions/:sessionId', async req =>
            await resolveSessionSaver(await getWebSessionRow(req.params.sessionId as string))
        );

        // ── Memories (accept ?sessionId= or ?threadId=) ──
        app.get('/api/memories/:memoryName', api(async req => {
            const svc = await AgentRunner.createMemoryService(req.params.memoryName as string);
            const memories = (await svc.getAllMemories()).map(m => ({
                id: m.id,
                content: m.content,
                createdAt: m.createdAt,
                lastAccessed: m.lastAccessed,
                accessCount: m.accessCount,
            }));
            await svc.dispose();
            return memories;
        }));

        app.post('/api/memories/:memoryName/add', api(async req => {
            const { content, autoSplit, chunkSize } = req.body as { content?: string; autoSplit?: boolean; chunkSize?: number };
            if (!content?.trim()) { const e: any = new Error('content is required'); e.status = 400; throw e; }
            const svc = await AgentRunner.createMemoryService(req.params.memoryName as string);
            const ids = await svc.addMemoryDirect(content.trim(), { autoSplit, chunkSize });
            await svc.dispose();
            return { ids };
        }));

        app.put('/api/memories/:memoryName/:memoryId', api(async req => {
            const { content } = req.body as { content?: string };
            if (!content?.trim()) { const e: any = new Error('content is required'); e.status = 400; throw e; }
            const svc = await AgentRunner.createMemoryService(req.params.memoryName as string);
            await svc.updateMemoryDirect(req.params.memoryId as string, content.trim());
            await svc.dispose();
        }));

        app.delete('/api/memories/:memoryName/:memoryId', api(async req => {
            const svc = await AgentRunner.createMemoryService(req.params.memoryName as string);
            await svc.deleteMemory(req.params.memoryId as string);
            await svc.dispose();
        }));

        app.delete('/api/memories/:memoryName', api(async req => {
            const svc = await AgentRunner.createMemoryService(req.params.memoryName as string);
            const count = await svc.clearAll();
            await svc.dispose();
            return { count };
        }));


        // ── Wiki ──
        app.get('/api/wikis/:wikiName', api(async req => {
            const svc = await AgentRunner.createWikiService(req.params.wikiName as string);
            const pages = await svc.getAllPages();
            return pages.map((p: any) => ({
                id: p.id, title: p.title, tags: p.tags,
                source: p.source, version: p.version,
                createdAt: p.createdAt, updatedAt: p.updatedAt,
            }));
        }));

        app.get('/api/wikis/:wikiName/pages/:pageId', api(async req => {
            const svc = await AgentRunner.createWikiService(req.params.wikiName as string);
            const page = await svc.getPage(req.params.pageId as string);
            if (!page) { const e: any = new Error('Page not found'); e.status = 404; throw e; }
            return page;
        }));

        app.post('/api/wikis/:wikiName/pages', api(async req => {
            const { title, content, tags } = req.body as { title?: string; content?: string; tags?: string[] };
            if (!title?.trim() || !content?.trim()) {
                const e: any = new Error('title and content are required'); e.status = 400; throw e;
            }
            const svc = await AgentRunner.createWikiService(req.params.wikiName as string);
            return svc.createPage(title, content, tags);
        }));

        app.put('/api/wikis/:wikiName/pages/:pageId', api(async req => {
            const svc = await AgentRunner.createWikiService(req.params.wikiName as string);
            return svc.updatePage(req.params.pageId as string, req.body);
        }));

        app.delete('/api/wikis/:wikiName/pages/:pageId', api(async req => {
            const svc = await AgentRunner.createWikiService(req.params.wikiName as string);
            await svc.deletePage(req.params.pageId as string);
            return { ok: true };
        }));

        app.get('/api/wikis/:wikiName/search', api(async req => {
            const query = req.query.q as string;
            const limit = parseInt(req.query.limit as string) || 5;
            if (!query?.trim()) { const e: any = new Error('q parameter is required'); e.status = 400; throw e; }
            const svc = await AgentRunner.createWikiService(req.params.wikiName as string);
            return svc.search(query, limit);
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

        app.put('/api/schedulers/:id', api(async req => {
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) throwBad('Invalid id');
            const body = req.body || {};
            const patch: { message?: string; targetId?: string; aiProcess?: boolean } = {};
            if (typeof body.message === 'string') {
                if (!body.message.trim()) throwBad('message is required');
                patch.message = body.message.trim();
            }
            if (body.targetId != null) {
                const tid = String(body.targetId).trim();
                if (!tid) throwBad('targetId is required');
                patch.targetId = tid;
            }
            if (typeof body.aiProcess === 'boolean') patch.aiProcess = body.aiProcess;
            const row = await schedulerService.update(id, patch);
            if (!row) throwBad('Scheduler not found');
            return { ...((row as any).toJSON ? (row as any).toJSON() : row), nextRun: schedulerService.nextDate(id) };
        }));

        app.delete('/api/schedulers/:id', api(async req => {
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) throwBad('Invalid id');
            await schedulerService.delete(id);
        }));
    }

    // ===== Heartbeats =====
    private registerHeartbeatRoutes(app: express.Application) {
        app.get('/api/heartbeats', api(async () => {
            return heartbeatService.getStatus();
        }));

        app.post('/api/heartbeats', api(async req => {
            return heartbeatService.create(req.body);
        }));

        app.put('/api/heartbeats/:id', api(async req => {
            const id = Number(req.params.id);
            if (!id) throwBad('Invalid heartbeat id');
            const row = await heartbeatService.update(id, req.body);
            if (!row) throwBad('Heartbeat not found');
            return row;
        }));

        app.delete('/api/heartbeats/:id', api(async req => {
            const id = Number(req.params.id);
            if (!id) throwBad('Invalid heartbeat id');
            await heartbeatService.delete(id);
            return { deleted: true };
        }));

        app.post('/api/heartbeats/:id/trigger', api(async req => {
            const id = Number(req.params.id);
            if (!id) throwBad('Invalid heartbeat id');
            const row = await heartbeatService.getById(id);
            if (!row) throwBad('Heartbeat not found');
            await heartbeatService.triggerOnce(id);
            return { triggered: true };
        }));

        app.post('/api/heartbeats/reload', api(async () => {
            await heartbeatService.reloadAll();
            return { reloaded: true };
        }));
    }

    // ===== Todos =====
    private registerTodoRoutes(app: express.Application) {
        // 把 channel_session 行转换成 todo 文件实际写入时使用的 threadId（= String(profile.id)）
        const sessionThreadId = (s: ChannelSessionRow): string =>
            s.profileId > 0 ? String(s.profileId) : s.sessionId;

        // 列出 todo（默认 pending，跨所有 session）
        // 支持 query:
        //   dbSessionId=过滤单个 session（数据库主键）
        //   sessionId=过滤 web channel 下的 session（UUID 字符串）
        //   status=pending|done|all
        app.get('/api/todos', api(async req => {
            const dbSessionIdQ = req.query.dbSessionId as string | undefined;
            const sessionIdQ   = req.query.sessionId   as string | undefined;
            const statusQ = (req.query.status as string | undefined) ?? 'pending';
            const where: any = {};
            if (dbSessionIdQ) where.id = parseInt(dbSessionIdQ, 10);
            else if (sessionIdQ) { where.channelId = WEB_CHANNEL_ID; where.sessionId = sessionIdQ; }
            const sessions = await database.findAll<ChannelSessionRow>(database.channelSession, { where });
            const all: any[] = [];
            for (const s of sessions) {
                const filePath = config.getSessionTodoPath(sessionThreadId(s));
                try {
                    const buf = await fsp.readFile(filePath, 'utf-8');
                    const data = JSON.parse(buf);
                    for (const t of data.todos ?? []) {
                        all.push({ ...t, dbSessionId: s.id, sessionName: s.sessionName || s.autoSessionName, channelId: s.channelId });
                    }
                } catch (e: any) {
                    if (e.code !== 'ENOENT') {
                        // ignore — corrupt todos files shouldn't break admin list
                    }
                }
            }
            if (statusQ === 'all') return all;
            return all.filter(t => t.status === statusQ);
        }));

        const resolveTodoFilePath = async (dbSessionId: string): Promise<string> => {
            const row = await getChannelSession(dbSessionId);
            if (!row) { const e: any = new Error(`channel_session id=${dbSessionId} not found`); e.status = 404; throw e; }
            return config.getSessionTodoPath(sessionThreadId(row));
        };

        app.patch('/api/todos/:dbSessionId/:id', api(async req => {
            const dbSessionId = req.params.dbSessionId as string;
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) throwBad('Invalid id');
            const filePath = await resolveTodoFilePath(dbSessionId);
            await mutateTodoFile(filePath, data => {
                const t = data.todos.find((x: any) => x.id === id);
                if (!t) throwBad('Todo not found');
                t.status = 'done';
                t.doneAt = new Date().toISOString();
            });
        }));

        app.delete('/api/todos/:dbSessionId/:id', api(async req => {
            const dbSessionId = req.params.dbSessionId as string;
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) throwBad('Invalid id');
            const filePath = await resolveTodoFilePath(dbSessionId);
            await mutateTodoFile(filePath, data => {
                const idx = data.todos.findIndex((x: any) => x.id === id);
                if (idx < 0) throwBad('Todo not found');
                data.todos.splice(idx, 1);
            });
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

        // session 编辑：只接收 sessionName / avatar / profileId；其他配置由 PUT /api/session-profiles/:id 单独修改
        app.put('/api/channel-sessions/:id', api(async req => {
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) throwBad('Invalid id');
            const { sessionName, avatar, profileId } = req.body as Record<string, any>;
            const update: Record<string, any> = {};
            if (sessionName !== undefined) update.sessionName = sessionName;
            if (avatar !== undefined) update.avatar = avatar;
            if (profileId !== undefined) {
                const targetId = Number(profileId);
                if (!targetId || targetId <= 0) throwBad('Invalid profileId');
                const target = await getSessionProfile(targetId);
                if (!target) throwBad(`Profile id=${targetId} not found`);
                if (target.autoForSessionId != null && target.autoForSessionId !== id) {
                    throwBad(`Profile id=${targetId} is auto profile of another session`);
                }
                update.profileId = targetId;
            }
            await database.update(database.channelSession, update, { where: { id } });
        }));

        // 把当前 profile 配置复制成新 visible profile，session.profileId 切到新的
        // 原 auto profile 保留（autoForSessionId 仍指向当前 session）
        app.post('/api/channel-sessions/:id/clone-profile', api(async req => {
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) throwBad('Invalid id');
            const { name } = (req.body ?? {}) as { name?: string };
            const session = await getChannelSession(id, true);
            if (!session) throwBad(`channel_session id=${id} not found`);
            const current = await getSessionProfile(session!.profileId);
            const profileName = (name && name.trim()) || `${session!.sessionName || session!.sessionId}-profile`;
            const created = await database.create<SessionProfileRow>(database.sessionProfile, {
                name: profileName,
                autoForSessionId: null,
                agentId: current?.agentId ?? null,
                saver: current?.saver ?? null,
                memories: current?.memories ?? null,
                wikis: current?.wikis ?? null,
                useChannelMemories: current?.useChannelMemories ?? null,
                useChannelWikis: current?.useChannelWikis ?? null,
                workPath: current?.workPath ?? null,
                streamVerbose: current?.streamVerbose ?? null,
                autoApproveAllTools: current?.autoApproveAllTools ?? null,
                approvalTimeout: current?.approvalTimeout ?? null,
                approvalTimeoutValue: current?.approvalTimeoutValue ?? null,
                askTimeout: current?.askTimeout ?? null,
                askTimeoutMessage: current?.askTimeoutMessage ?? null,
                intentModel: current?.intentModel ?? null,
                intentPrompt: current?.intentPrompt ?? null,
                intentThreshold: current?.intentThreshold ?? null,
                createdAt: Date.now(),
            });
            await database.update(database.channelSession, { profileId: (created as any).id }, { where: { id } });
            return { profileId: (created as any).id };
        }));

        // 切回独立：session.profileId 指回 session 自己的 auto profile（clone-profile 时保留）
        // 若不存在 auto profile（旧数据或异常清理），自动补建一个空 auto profile
        app.post('/api/channel-sessions/:id/detach-profile', api(async req => {
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) throwBad('Invalid id');
            const session = await getChannelSession(id, true);
            if (!session) throwBad(`channel_session id=${id} not found`);
            let auto = await database.findOne<SessionProfileRow>(database.sessionProfile, { where: { autoForSessionId: id } });
            if (!auto) {
                auto = await database.create<SessionProfileRow>(database.sessionProfile, {
                    name: '',
                    autoForSessionId: id,
                    createdAt: Date.now(),
                });
            }
            await database.update(database.channelSession, { profileId: (auto as any).id }, { where: { id } });
            return { profileId: (auto as any).id };
        }));

        app.get('/api/channel-sessions/:id/effective-config', api(async req => {
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) throwBad('Invalid id');
            const eff = await getEffectiveSession(id, true);
            if (!eff) { const e: any = new Error(`channel_session id=${id} not found`); e.status = 404; throw e; }
            return eff;
        }));

        app.delete('/api/channel-sessions/:id', api(async req => {
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) throwBad('Invalid id');
            // 级联删除该 session 的 auto profile（visible profile 不删）
            await database.destroy(database.sessionProfile, { where: { autoForSessionId: id } });
            await database.destroy(database.channelSession, { where: { id } });
        }));

        // ── Session Profiles（仅 visible，autoForSessionId == null） ──
        app.get('/api/session-profiles', api(async () => {
            const profiles = await database.findAll<SessionProfileRow>(database.sessionProfile, { where: { autoForSessionId: null } });
            const result = await Promise.all(profiles.map(async (p: any) => {
                const sessionCount = await database.count(database.channelSession, { where: { profileId: p.id } });
                return { ...p, sessionCount };
            }));
            return result;
        }));

        app.get('/api/session-profiles/:id', api(async req => {
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) throwBad('Invalid id');
            const profile = await getSessionProfile(id);
            if (!profile) { const e: any = new Error(`SessionProfile id=${id} not found`); e.status = 404; throw e; }
            const sessions = await database.findAll<ChannelSessionRow>(database.channelSession, { where: { profileId: id } });
            return { ...profile, sessions };
        }));

        app.post('/api/session-profiles', api(async req => {
            const { name } = req.body as Record<string, any>;
            if (!name) throwBad('name is required');
            const created = await database.create<SessionProfileRow>(database.sessionProfile, {
                name: String(name),
                autoForSessionId: null,
                createdAt: Date.now(),
            });
            return created;
        }));

        app.put('/api/session-profiles/:id', api(async req => {
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) throwBad('Invalid id');
            const b = req.body as Record<string, any>;
            const memSer = b.memories === undefined ? undefined : (b.memories === null ? null : JSON.stringify(b.memories || []));
            const wikiSer = b.wikis === undefined ? undefined : (b.wikis === null ? null : JSON.stringify(b.wikis || []));
            const update: Record<string, any> = {
                name: b.name,
                agentId: b.agentId === undefined ? undefined : (b.agentId || null),
                saver: b.saver === undefined ? undefined : (b.saver || null),
                memories: memSer,
                wikis: wikiSer,
                useChannelMemories: b.useChannelMemories === undefined ? undefined : (b.useChannelMemories === null ? null : !!b.useChannelMemories),
                useChannelWikis: b.useChannelWikis === undefined ? undefined : (b.useChannelWikis === null ? null : !!b.useChannelWikis),
                workPath: b.workPath === undefined ? undefined : (b.workPath || null),
                streamVerbose: b.streamVerbose === undefined ? undefined : (b.streamVerbose ?? null),
                autoApproveAllTools: b.autoApproveAllTools === undefined ? undefined : (b.autoApproveAllTools ?? null),
                approvalTimeout: b.approvalTimeout === undefined ? undefined : (b.approvalTimeout ?? null),
                approvalTimeoutValue: b.approvalTimeoutValue === undefined ? undefined : (b.approvalTimeoutValue ?? null),
                askTimeout: b.askTimeout === undefined ? undefined : (b.askTimeout ?? null),
                askTimeoutMessage: b.askTimeoutMessage === undefined ? undefined : (b.askTimeoutMessage || null),
                intentModel: b.intentModel === undefined ? undefined : (b.intentModel ?? null),
                intentPrompt: b.intentPrompt === undefined ? undefined : (b.intentPrompt || null),
                intentThreshold: b.intentThreshold === undefined ? undefined : (b.intentThreshold ?? null),
            };
            for (const k of Object.keys(update)) if (update[k] === undefined) delete update[k];
            await database.update(database.sessionProfile, update, { where: { id } });
        }));

        app.delete('/api/session-profiles/:id', api(async req => {
            const id = parseInt(req.params.id as string, 10);
            if (isNaN(id)) throwBad('Invalid id');
            const profile = await getSessionProfile(id);
            if (!profile) throwBad(`Profile id=${id} not found`);
            if (profile!.autoForSessionId != null) throwBad('Cannot delete an auto profile directly');
            const refCount = await database.count(database.channelSession, { where: { profileId: id } });
            if (refCount > 0) throwBad(`Profile id=${id} is still referenced by ${refCount} session(s)`);
            await database.destroy(database.sessionProfile, { where: { id } });
        }));

        app.post('/api/channels/:channelId/send', api(async req => {
            const channelId = req.params.channelId as string;
            const { sessionId, type, content, payload } = req.body as Record<string, any>;
            if (!sessionId) throwBad('sessionId is required');
            if (!type) throwBad('type is required');
            let ok: boolean;
            switch (type) {
                case 'text':
                    if (!content) throwBad('content is required for type "text"');
                    ok = await channelManager.sendText(channelId, sessionId, content);
                    break;
                case 'file':
                    if (!content) throwBad('content (file path) is required for type "file"');
                    ok = await channelManager.sendFile(channelId, sessionId, content, req.body.fileName);
                    break;
                case 'native':
                    if (!payload) throwBad('payload is required for type "native"');
                    ok = await channelManager.sendNative(channelId, sessionId, payload);
                    break;
                default:
                    throwBad(`Unknown type "${type}", expected "text" | "file" | "native"`);
            }
            if (!ok) throwBad(`Channel "${channelId}" not found or not running`);
        }));

        // --- QR code login ---
        // Supports both /api/channel-plugins/:type/qrcode/:key (add flow)
        // and /api/channels/:id/qrcode/:key (edit flow, auto-persists)

        const resolvePlugin = (req: express.Request) => {
            if (req.params.type) {
                return { type: req.params.type as string, channel: null };
            }
            const id = req.params.id as string;
            const channel = channelManager.getChannel(id);
            if (!channel) throwBad(`Channel "${id}" not found`);
            return { type: channel!.type, channel };
        };

        const qrCodeHandler = api(async (req: express.Request) => {
            const { type } = resolvePlugin(req);
            const key = req.params.key as string;
            const plugin = channelManager.getPlugin(type);
            if (!plugin?.getQRCode) throwBad(`Plugin "${type}" does not support QR code login`);
            return plugin.getQRCode(key, req.body);
        });

        const qrConfirmHandler = api(async (req: express.Request) => {
            const { type, channel } = resolvePlugin(req);
            const key = req.params.key as string;
            const plugin = channelManager.getPlugin(type);
            if (!plugin?.awaitQRResult) throwBad(`Plugin "${type}" does not support QR code login`);

            const credentials = await plugin.awaitQRResult(key);
            if (!credentials) return { status: "expired" };

            if (channel) {
                const id = req.params.id as string;
                const cfg = channel.config ?? {};
                cfg[key] = credentials;
                channel.config = cfg;
                config.saveSettings();
                await channelManager.reloadChannel(id);
            }

            return { status: "confirmed", credentials };
        });

        app.post('/api/channel-plugins/:type/qrcode/:key', qrCodeHandler);
        app.post('/api/channel-plugins/:type/qrcode/:key/confirm', qrConfirmHandler);
        app.post('/api/channels/:id/qrcode/:key', qrCodeHandler);
        app.post('/api/channels/:id/qrcode/:key/confirm', qrConfirmHandler);
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
        app.get('/api/session-status', async (req, res) => {
            const { sessionId } = req.query as { sessionId?: string };
            if (!sessionId) { res.status(400).json({ error: 'sessionId is required' }); return; }
            const row = await database.findOne<ChannelSessionRow>(database.channelSession, { where: { channelId: WEB_CHANNEL_ID, sessionId } });
            const threadId = row && row.profileId > 0 ? String(row.profileId) : sessionId;
            const info = sessionManager.getInfo(threadId);
            if (!info) { res.json(null); return; }
            res.json(info);
        });

    }
}

export const httpServer = new HttpServer();
