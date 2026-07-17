import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { LoggerService } from './Core/LoggerService';
import { channelDataService } from './Session/ChannelDataService';

const logger = LoggerService.getLogger('HttpServer.ts');

/** 资源管理器 / 文件读取最大字节数 */
export const MAX_FILE_READ_SIZE = 10 * 1024 * 1024;

/** 统一 400 异常 */
export function throwBad(msg: string): never {
    const e: any = new Error(msg); e.status = 400; throw e;
}

/** 兼容 sequelize Model 与 plain 对象，统一转 JSON 可序列化的纯对象 */
export function toPlain<T>(row: T): T {
    const r = row as { toJSON?: () => T };
    return typeof r.toJSON === 'function' ? r.toJSON() : row;
}

/** 目录优先、再按名称排序 */
export function dirFirstByName(a: { isDirectory(): boolean; name: string }, b: { isDirectory(): boolean; name: string }) {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
}

/**
 * 解析用户传入路径并校验为存在的目录。返回 stat 一并避免重复 syscall。
 * 路径不存在或不是目录时抛 400。
 */
export function resolveExistingDir(input: string): { target: string; stat: fs.Stats } {
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
export function safeRelPath(relPath: string | undefined): string {
    if (!relPath?.trim()) throwBad('path is required');
    const normalized = path.normalize(relPath!.trim()).replace(/\\/g, '/');
    if (normalized.startsWith('..') || path.isAbsolute(normalized)) throwBad('Invalid path');
    return normalized;
}

export function isPathInside(base: string, target: string): boolean {
    const rel = path.relative(base, target);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function parseRangeQuery(req: Request): { offset?: number; limit?: number } {
    const offset = req.query.offset != null ? Number(req.query.offset) : undefined;
    const limit = req.query.limit != null ? Number(req.query.limit) : undefined;
    return {
        offset: Number.isFinite(offset as number) ? offset : undefined,
        limit: Number.isFinite(limit as number) ? limit : undefined,
    };
}

/** 将工具的 schema 统一转换为 JSON Schema 纯对象 */
export function toJsonSchema(schema: any): any {
    if (schema && typeof schema.parse === 'function') {
        return z.toJSONSchema(schema);
    }
    return schema;
}

/** 统一异常包装：捕获异常并返回标准 JSON 响应 */
export function api(fn: (req: Request, res: Response) => any) {
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

/**
 * 全局取会话可读名：sessionName → autoSessionName → sessionId → String(id)。
 * 内部 try-catch，查不到或出错时回退：有 id 用 String(id)，id 为空用 "?"。
 * 永不返回空串，调用方无需再 `|| "?"` 兜底。任何文件 `import { getSessionName }` 即可。
 */
export async function getSessionName(id: number | string | null | undefined): Promise<string> {
    const fallback = id == null ? '?' : String(id);
    try {
        const row = await channelDataService.getSession(id);
        return row ? (row.sessionName || row.autoSessionName || row.sessionId || fallback) : fallback;
    } catch {
        return fallback;
    }
}
