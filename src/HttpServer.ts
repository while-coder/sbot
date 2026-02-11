import express from 'express';
import http from 'http';
import path from 'path';
import { config } from './Config';
import { LoggerService } from './LoggerService';
import { LarkUserService } from './Lark/LarkUserService';

const logger = LoggerService.getLogger('HttpServer.ts');

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

        // ===== Settings API =====

        // 获取完整 settings
        app.get('/api/settings', (_req, res) => {
            try {
                res.json({ success: true, data: config.settings });
            } catch (e: any) {
                res.status(500).json({ success: false, message: e.message });
            }
        });

        // 更新完整 settings
        app.put('/api/settings', (req, res) => {
            try {
                const newSettings = req.body;
                Object.assign(config.settings, newSettings);
                config.saveSettings();
                res.json({ success: true, data: config.settings });
            } catch (e: any) {
                res.status(500).json({ success: false, message: e.message });
            }
        });

        // ===== MCP API =====

        // 获取 MCP 配置
        app.get('/api/mcp', (_req, res) => {
            try {
                res.json({ success: true, data: config.getMcpServers() });
            } catch (e: any) {
                res.status(500).json({ success: false, message: e.message });
            }
        });

        // 更新 MCP 配置
        app.put('/api/mcp', (req, res) => {
            try {
                const mcpServers = req.body;
                config.saveMcpServers(mcpServers);
                res.json({ success: true, data: config.getMcpServers() });
            } catch (e: any) {
                res.status(500).json({ success: false, message: e.message });
            }
        });

        // ===== 操作 API =====

        // 重载配置
        app.post('/api/reload', (_req, res) => {
            try {
                config.reloadSettings();
                // 清除所有用户缓存，使新配置生效
                LarkUserService.allUsers.clear();
                res.json({ success: true, message: '配置已重载' });
            } catch (e: any) {
                res.status(500).json({ success: false, message: e.message });
            }
        });

        http.createServer(app).listen(port, () => {
            logger.info(`HTTP 服务启动成功: http://127.0.0.1:${port}`);
            logger.info(`管理页面: http://127.0.0.1:${port}/client/`);
        });
    }
}

export const httpServer = new HttpServer();
