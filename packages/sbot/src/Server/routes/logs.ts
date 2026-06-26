import express from 'express';
import fs from 'fs';
import path from 'path';
import { config } from '../../Core/Config';
import { api, throwBad } from '../utils';
import type { RouteContext } from './types';

export class LogRoutes {
    register(app: express.Application, _ctx: RouteContext): void {
        const logsDir = config.getConfigPath('logs', true);

        // 列出日志文件
        app.get('/api/logs', api(async () => {
            const files = await fs.promises.readdir(logsDir);
            return files
                .filter(f => f.endsWith('.log'))
                .sort()
                .reverse();
        }));

        // 校验并解析日志文件路径，非法或不存在时抛 400
        const resolveLogFile = (filename: string): string => {
            if (!filename.endsWith('.log') || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
                throwBad('Invalid filename');
            }
            const filepath = path.join(logsDir, filename);
            if (!fs.existsSync(filepath)) throwBad('File not found');
            return filepath;
        };

        // 下载整个日志文件（原始内容，作为附件）
        app.get('/api/logs/:filename/download', (req, res) => {
            try {
                const filename = req.params.filename as string;
                const filepath = resolveLogFile(filename);
                const encoded = encodeURIComponent(filename);
                res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                res.setHeader(
                    'Content-Disposition',
                    `attachment; filename="${filename.replace(/"/g, '\\"')}"; filename*=UTF-8''${encoded}`,
                );
                res.sendFile(path.resolve(filepath));
            } catch (e: any) {
                res.status(e?.status ?? 404).json({ success: false, message: e?.message ?? 'not found' });
            }
        });

        // 读取指定日志文件内容（支持 tail 行数）
        app.get('/api/logs/:filename', api(async req => {
            const filename = req.params.filename as string;
            const filepath = resolveLogFile(filename);

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
}

export const logRoutes = new LogRoutes();
