import express from 'express';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { Op } from 'sequelize';
import { config } from '../../Core/Config';
import { LoggerService } from '../../Core/LoggerService';
import { refreshGlobalSkillService } from '../../Agent/GlobalSkillService';
import { refreshGlobalAgentToolService } from '../../Agent/GlobalAgentToolService';
import { database, type UsageLogRow } from '../../Core/Database';
import { channelDataService } from '../../Session/ChannelDataService';
import { api, throwBad } from '../../utils';
import type { RouteContext } from './types';

const logger = LoggerService.getLogger('HttpServer.ts');

// 解析 usage 查询的时间参数：纯数字当毫秒时间戳，否则当 ISO 字符串；解析失败回退默认值。
function parseUsageTime(v: unknown, def: number): number {
    if (!v) return def;
    const s = String(v);
    const n = Number(s);
    return Number.isFinite(n) && /^\d+$/.test(s) ? n : new Date(s).getTime() || def;
}

function applyUsageFilters(where: Record<string, any>, query: Record<string, any>): void {
    for (const key of ['agentId', 'modelId', 'provider', 'channelId'] as const) {
        const value = query[key];
        if (typeof value === 'string' && value) where[key] = value;
    }
}

type UsageAggregate = {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    calls: number;
};

function createUsageAggregate(): UsageAggregate {
    return { inputTokens: 0, outputTokens: 0, totalTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, calls: 0 };
}

function accrueUsage(target: UsageAggregate, row: UsageLogRow): void {
    target.inputTokens += row.inputTokens;
    target.outputTokens += row.outputTokens;
    target.totalTokens += row.totalTokens;
    target.cacheCreationTokens += row.cacheCreationTokens;
    target.cacheReadTokens += row.cacheReadTokens;
    target.calls += 1;
}

function readBundledMarkdown(name: 'README.md' | 'README.zh.md'): string {
    const candidates = [
        // Compiled package layout: dist/dist/Server/routes -> dist/
        path.resolve(__dirname, '../../../', name),
        // Source/dev layout when run directly from the monorepo.
        path.resolve(__dirname, '../../../../../', name),
        path.resolve(process.cwd(), name),
    ];
    for (const file of candidates) {
        try {
            if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
        } catch {
            // Optional About-page content; ignore unreadable candidates.
        }
    }
    return '';
}

export class SystemRoutes {
    register(app: express.Application, ctx: RouteContext): void {
        app.get('/api/about', api(req => {
            const data = {
                version: config.pkg.version,
                name: config.pkg.name,
                description: config.pkg.description,
                releasenoteEn: config.pkg.releasenoteEn || '',
                releasenoteZh: config.pkg.releasenoteZh || '',
            };
            if (req.query.readme !== '1') return data;

            const readmeEn = readBundledMarkdown('README.md');
            const readmeZh = readBundledMarkdown('README.zh.md') || readmeEn;
            return { ...data, readmeEn, readmeZh };
        }));

        app.post('/api/reload', api(() => {
            config.reloadSettings();
            refreshGlobalSkillService();
            refreshGlobalAgentToolService();
            // 缓存里的 MemoryService 不强制丢弃 —— pool 不开放外部 invalidate（同 id 双实例会破坏 store）。
            // 已 acquire 的实例继续吃旧配置，refCount 归零自然 evict，下次 acquire 才拿到 reload 后的配置。
            return { message: 'Config reloaded' };
        }));

        app.post('/api/shutdown', api(async () => {
            logger.info('Shutdown requested via API');
            // 进入排空状态后拒绝新任务；现有 Agent / memory / agenda 工作完成后再退出。
            void ctx.shutdown();
            return { message: 'Shutdown initiated; waiting for active work to finish...' };
        }));

        // 清理跨表引用孤儿数据。默认 dryRun：只返回报告不删，?apply=1 才真正清。
        app.post('/api/admin/cleanup-orphans', api(async req => {
            const apply = req.query.apply === '1' || req.body?.apply === true;
            return channelDataService.cleanupOrphans({ dryRun: !apply });
        }));

        app.get('/api/proxy', api(async (req, res) => {
            const url = req.query.url as string | undefined;
            if (!url?.trim()) throwBad('Missing url');
            const upstream = await axios.get(url!.trim(), { responseType: 'stream', timeout: 15000 });
            const headers = upstream.headers;
            if (headers['content-type']) res.setHeader('Content-Type', String(headers['content-type']));
            if (headers['content-length']) res.setHeader('Content-Length', String(headers['content-length']));
            res.status(upstream.status);
            upstream.data.pipe(res);
        }));

        // Token 用量总览：一次返回汇总、趋势、维度明细和筛选项。
        app.get('/api/usage-overview', api(async (req) => {
            const now = Date.now();
            const endMs = parseUsageTime(req.query.end, now);
            const startMs = parseUsageTime(req.query.start, now - 30 * 24 * 3600_000);
            const granularity = req.query.granularity === 'hourly' ? 'hourly' : 'daily';
            const where: any = { timestamp: { [Op.gte]: startMs, [Op.lt]: endMs } };
            applyUsageFilters(where, req.query);

            const rows = await database.findAll<UsageLogRow>(database.usageLogs, {
                where,
                order: [['timestamp', 'ASC']],
            });

            type Breakdown = UsageAggregate & { key: string; label: string };
            type TrendBucket = UsageAggregate & { date?: string; hour?: string; startMs: number; endMs: number };
            const summary = createUsageAggregate();
            const trend = new Map<string, TrendBucket>();
            const model = new Map<string, Breakdown>();
            const agent = new Map<string, Breakdown>();
            const provider = new Map<string, Breakdown>();
            const channel = new Map<string, Breakdown>();

            const accrueBreakdown = (map: Map<string, Breakdown>, key: string, label: string, row: UsageLogRow) => {
                let item = map.get(key);
                if (!item) {
                    item = { key, label, ...createUsageAggregate() };
                    map.set(key, item);
                }
                if (label) item.label = label;
                accrueUsage(item, row);
            };

            for (const row of rows) {
                accrueUsage(summary, row);
                accrueBreakdown(model, row.modelId, row.modelName, row);
                accrueBreakdown(agent, row.agentId, row.agentName, row);
                accrueBreakdown(provider, row.provider, row.provider, row);
                accrueBreakdown(channel, row.channelId, config.getChannel(row.channelId)?.name || '', row);

                const date = new Date(Number(row.timestamp));
                const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                const hour = `${day}T${String(date.getHours()).padStart(2, '0')}`;
                const key = granularity === 'hourly' ? hour : day;
                let bucket = trend.get(key);
                if (!bucket) {
                    const bucketStart = granularity === 'hourly'
                        ? new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()).getTime()
                        : new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
                    const bucketEnd = granularity === 'hourly'
                        ? bucketStart + 3600_000
                        : new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
                    bucket = {
                        ...(granularity === 'hourly' ? { hour } : { date: day }),
                        startMs: bucketStart,
                        endMs: bucketEnd,
                        ...createUsageAggregate(),
                    };
                    trend.set(key, bucket);
                }
                accrueUsage(bucket, row);
            }

            // 筛选项只受时间范围影响，避免选择某项后其他候选项消失。
            const optionRows = await database.findAll<UsageLogRow>(database.usageLogs, {
                where: { timestamp: { [Op.gte]: startMs, [Op.lt]: endMs } },
                attributes: ['agentId', 'agentName', 'modelId', 'modelName', 'provider', 'channelId'],
                group: ['agentId', 'agentName', 'modelId', 'modelName', 'provider', 'channelId'],
            });

            const agents = new Map<string, string>();
            const models = new Map<string, string>();
            const providers = new Set<string>();
            const channels = new Set<string>();
            for (const row of optionRows) {
                if (row.agentId) agents.set(row.agentId, row.agentName || row.agentId);
                if (row.modelId) models.set(row.modelId, row.modelName || row.modelId);
                if (row.provider) providers.add(row.provider);
                if (row.channelId) channels.add(row.channelId);
            }
            const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label);
            const sortDesc = (map: Map<string, Breakdown>) => Array.from(map.values()).sort((a, b) => b.totalTokens - a.totalTokens);
            return {
                summary,
                trend: Array.from(trend.values()).sort((a, b) => a.startMs - b.startMs),
                byModel: sortDesc(model),
                byAgent: sortDesc(agent),
                byProvider: sortDesc(provider),
                byChannel: sortDesc(channel),
                filterOptions: {
                    agents: Array.from(agents, ([id, label]) => ({ id, label })).sort(byLabel),
                    models: Array.from(models, ([id, label]) => ({ id, label })).sort(byLabel),
                    providers: Array.from(providers).sort(),
                    channels: Array.from(channels, id => ({ id, label: config.getChannel(id)?.name || '' })).sort(byLabel),
                },
            };
        }));

        // 调用明细分页，按时间倒序。
        app.get('/api/usage-logs', api(async (req) => {
            const now = Date.now();
            const endMs = parseUsageTime(req.query.end, now);
            const startMs = parseUsageTime(req.query.start, now - 7 * 24 * 3600_000);
            const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
            const offset = Math.max(Number(req.query.offset) || 0, 0);

            const where: any = { timestamp: { [Op.gte]: startMs, [Op.lt]: endMs } };
            applyUsageFilters(where, req.query);

            const total = await database.count(database.usageLogs, { where });
            const rows = await database.findAll<UsageLogRow>(database.usageLogs, {
                where,
                order: [['timestamp', 'DESC']],
                limit,
                offset,
            });
            return { rows, total };
        }));

        // 按 threadId/profileId 查询 token 用量。
        app.get('/api/thread-usage', api(async req => {
            const threads = (req.query.threads as string || '').split(',').filter(Boolean);
            const sessions = (req.query.sessions as string || '').split(',').filter(Boolean);
            const result: Record<string, any> = {};
            if (threads.length > 0) Object.assign(result, await database.loadThreadUsages(threads));
            for (const sid of sessions) {
                const profileId = Number(sid);
                const profile = Number.isInteger(profileId) && profileId > 0 ? await channelDataService.getProfile(profileId) : null;
                if (profile) result[sid] = { inputTokens: profile.inputTokens, outputTokens: profile.outputTokens, totalTokens: profile.totalTokens, lastInputTokens: profile.lastInputTokens, lastOutputTokens: profile.lastOutputTokens, lastTotalTokens: profile.lastTotalTokens };
            }
            return result;
        }));
    }
}

export const systemRoutes = new SystemRoutes();
