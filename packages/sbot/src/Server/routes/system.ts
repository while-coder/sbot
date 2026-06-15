import express from 'express';
import axios from 'axios';
import { Op } from 'sequelize';
import { config } from '../../Core/Config';
import { LoggerService } from '../../Core/LoggerService';
import { refreshGlobalSkillService } from '../../Agent/GlobalSkillService';
import { refreshGlobalAgentToolService } from '../../Agent/GlobalAgentToolService';
import { database, type UsageLogRow } from '../../Core/Database';
import { channelDataService } from '../../Session/ChannelDataService';
import { memoryServicePool } from '../../Memory/MemoryServicePool';
import { api, throwBad } from '../utils';
import type { RouteContext } from './types';

const logger = LoggerService.getLogger('HttpServer.ts');

export class SystemRoutes {
    register(app: express.Application, ctx: RouteContext): void {
        app.get('/api/about', api(() =>
            ({ version: config.pkg.version, name: config.pkg.name, description: config.pkg.description, releasenoteEn: config.pkg.releasenoteEn || '', releasenoteZh: config.pkg.releasenoteZh || '' })
        ));

        app.post('/api/reload', api(() => {
            config.reloadSettings();
            refreshGlobalSkillService();
            refreshGlobalAgentToolService();
            // settings 重新加载后，缓存的 MemoryService 可能绑着旧 writerModel / prompt，全部丢掉
            memoryServicePool.invalidateAll();
            return { message: 'Config reloaded' };
        }));

        app.post('/api/shutdown', api(async () => {
            logger.info('Shutdown requested via API');
            // 先返回响应，再异步关闭服务
            setTimeout(() => ctx.shutdown(), 500);
            return { message: 'Shutting down...' };
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
