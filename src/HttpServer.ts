import express, { Request, Response } from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { AgentSqliteSaver, MemoryDatabase } from "scorpio.ai";
import { config } from './Config';
import { LoggerService } from './LoggerService';
import { LarkUserService } from './Lark/LarkUserService';

const logger = LoggerService.getLogger('HttpServer.ts');

/** 统一异常包装：捕获异常并返回标准 JSON 响应 */
function api(fn: (req: Request, res: Response) => any) {
    return async (req: Request, res: Response) => {
        try {
            const result = await fn(req, res);
            if (result !== undefined) res.json({ success: true, data: result });
        } catch (e: any) {
            res.status(e.status ?? 500).json({ success: false, message: e.message });
        }
    };
}

class HttpServer {
    async start() {
        const port = parseInt(process.env.HTTP_PORT ?? '5400');
        const app = express();
        app.use(express.json());

        // CORS
        app.all(/(.*)/, (_req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Credentials', 'true');
            res.header('Access-Control-Allow-Headers', 'Content-Type,Content-Length,Authorization,Accept,X-Requested-With');
            res.header('Access-Control-Allow-Methods', 'PUT,POST,GET,DELETE,OPTIONS');
            if (_req.method === 'OPTIONS') { res.sendStatus(200); return; }
            next();
        });

        // 静态文件
        app.use('/client', express.static(path.resolve(__dirname, '../client')));

        // ===== Settings =====
        app.get('/api/settings', api(() => config.settings));

        app.put('/api/settings', api(req => {
            Object.assign(config.settings, req.body);
            config.saveSettings();
            return config.settings;
        }));

        // ===== MCP =====
        app.get('/api/mcp', api(() => config.getMcpServers()));

        app.put('/api/mcp', api(req => {
            config.saveMcpServers(req.body);
            return config.getMcpServers();
        }));

        app.post('/api/mcp/tools', api(async req => {
            const { name, config: mcpConfig } = req.body;
            if (!name || !mcpConfig) {
                const e: any = new Error('缺少 name 或 config 参数');
                e.status = 400;
                throw e;
            }
            const mcpClient = new MultiServerMCPClient({ mcpServers: { [name]: mcpConfig } });
            const tools = await mcpClient.getTools();
            return tools.map(t => ({ name: t.name, description: t.description, parameters: t.schema }));
        }));

        // ===== 用户列表 =====
        app.get('/api/users', api(() => {
            const usersDir = config.getConfigPath('users', true);
            return fs.existsSync(usersDir)
                ? fs.readdirSync(usersDir, { withFileTypes: true })
                    .filter(d => d.isDirectory())
                    .map(d => d.name)
                : [];
        }));

        // ===== 历史记录 =====
        app.get('/api/users/:userId/history', api(async req => {
            const userId = req.params.userId as string;
            const saver = new AgentSqliteSaver(config.getUserSaverPath(userId));
            const messages = await saver.getMessages(userId);
            await saver.dispose();
            return messages.map(m => ({
                role: (m as any)._getType?.() ?? 'unknown',
                content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
            }));
        }));

        app.delete('/api/users/:userId/history', api(async req => {
            const userId = req.params.userId as string;
            const saver = new AgentSqliteSaver(config.getUserSaverPath(userId));
            await saver.clearThread(userId);
            await saver.dispose();
            LarkUserService.allUsers.delete(userId);
        }));

        // ===== 长期记忆 =====
        app.get('/api/users/:userId/memory', api(req => {
            const userId = req.params.userId as string;
            const db = new MemoryDatabase(config.getUserMemoryPath(userId));
            return db.getAllMemories(userId).map(m => ({
                id: m.id,
                content: m.content,
                importance: m.metadata.importance,
                timestamp: m.metadata.timestamp,
                lastAccessed: m.metadata.lastAccessed,
                accessCount: m.metadata.accessCount,
                tags: m.metadata.tags,
                category: m.metadata.category,
            }));
        }));

        app.delete('/api/users/:userId/memory/:memoryId', api(req => {
            const userId = req.params.userId as string;
            const memoryId = req.params.memoryId as string;
            const db = new MemoryDatabase(config.getUserMemoryPath(userId));
            db.deleteMemory(memoryId);
        }));

        app.delete('/api/users/:userId/memory', api(req => {
            const userId = req.params.userId as string;
            const db = new MemoryDatabase(config.getUserMemoryPath(userId));
            const count = db.clearAllMemories(userId);
            return { count };
        }));

        // ===== 操作 =====
        app.post('/api/reload', api(() => {
            config.reloadSettings();
            LarkUserService.allUsers.clear();
            return { message: '配置已重载' };
        }));

        http.createServer(app).listen(port, () => {
            logger.info(`HTTP 服务启动成功: http://127.0.0.1:${port}`);
            logger.info(`管理页面: http://127.0.0.1:${port}/client/`);
        });
    }
}

export const httpServer = new HttpServer();
