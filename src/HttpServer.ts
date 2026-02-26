import express, { Request, Response } from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { AgentSqliteSaver, MemorySqliteDatabase, MCPServers } from "scorpio.ai";
import { config } from './Config';
import { globalAgentToolService, refreshGlobalAgentToolService, BuiltinProvider } from './GlobalAgentToolService';
import { LoggerService } from './LoggerService';
import { LarkUserService } from './Lark/LarkUserService';
import { WebUserService } from './Web/WebUserService';

const logger = LoggerService.getLogger('HttpServer.ts');

// ===== Skills 辅助函数 =====
function listSkills(skillsDir: string) {
    if (!fs.existsSync(skillsDir)) return [];
    return fs.readdirSync(skillsDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .filter(d => fs.existsSync(path.join(skillsDir, d.name, 'SKILL.md')))
        .map(d => {
            const content = fs.readFileSync(path.join(skillsDir, d.name, 'SKILL.md'), 'utf-8');
            let description = '';
            const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
            if (match) {
                const descMatch = match[1].match(/description:\s*"?([^"\n]+)"?\s*$/m);
                if (descMatch) description = descMatch[1].trim();
            }
            return { name: d.name, description };
        });
}

function getSkill(skillsDir: string, name: string) {
    const skillMdPath = path.join(skillsDir, name, 'SKILL.md');
    if (!fs.existsSync(skillMdPath)) {
        const e: any = new Error(`Skill "${name}" 不存在`);
        e.status = 404;
        throw e;
    }
    return { name, content: fs.readFileSync(skillMdPath, 'utf-8') };
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

        // 根路径重定向到 /client
        app.get('/', (_req, res) => res.redirect('/client/'));

        // ===== Settings =====
        app.get('/api/settings', api(() => config.settings));

        app.put('/api/settings', api(req => {
            Object.assign(config.settings, req.body);
            config.saveSettings();
            return config.settings;
        }));

        // ===== MCP =====
        app.get('/api/mcp', api(() => ({
            builtins: Object.values(BuiltinProvider),
            servers: config.getGlobalMcpServers(),
        })));

        app.put('/api/mcp', api(req => {
            const builtinSet = new Set<string>(Object.values(BuiltinProvider));
            const servers = Object.fromEntries(
                Object.entries(req.body).filter(([name]) => !builtinSet.has(name))
            ) as MCPServers;
            config.saveMcpServers(servers);
            refreshGlobalAgentToolService();
            return { builtins: Object.values(BuiltinProvider), servers: config.getGlobalMcpServers() };
        }));

        app.post('/api/mcp/tools', api(async req => {
            const { name } = req.body;
            if (!name) {
                const e: any = new Error('缺少 name 参数');
                e.status = 400;
                throw e;
            }
            const tools = await globalAgentToolService.getToolsFrom([name]);
            return tools.map(t => ({ name: t.name, description: t.description, parameters: t.schema }));
        }));

        // ===== Agent MCP =====
        app.get('/api/agents/:name/mcp', api(req => config.getAgentMcpServers(req.params.name as string)));

        app.put('/api/agents/:name/mcp', api(req => {
            const name = req.params.name as string;
            config.saveAgentMcpServers(name, req.body);
            return config.getAgentMcpServers(name);
        }));

        // ===== Skills =====
        app.get('/api/skills', api(() => listSkills(config.getSkillsPath())));

        app.get('/api/skills/:name', api(req => getSkill(config.getSkillsPath(), req.params.name as string)));

        app.put('/api/skills/:name', api(req => {
            const name = req.params.name as string;
            if (!req.body.content) { const e: any = new Error('缺少 content'); e.status = 400; throw e; }
            return saveSkill(config.getSkillsPath(), name, req.body.content);
        }));

        app.delete('/api/skills/:name', api(req => deleteSkill(config.getSkillsPath(), req.params.name as string)));

        // ===== Agent Skills =====
        app.get('/api/agents/:name/skills', api(req => listSkills(config.getAgentSkillsPath(req.params.name as string))));

        app.get('/api/agents/:name/skills/:skillName', api(req =>
            getSkill(config.getAgentSkillsPath(req.params.name as string), req.params.skillName as string)));

        app.put('/api/agents/:name/skills/:skillName', api(req => {
            if (!req.body.content) { const e: any = new Error('缺少 content'); e.status = 400; throw e; }
            return saveSkill(config.getAgentSkillsPath(req.params.name as string), req.params.skillName as string, req.body.content);
        }));

        app.delete('/api/agents/:name/skills/:skillName', api(req =>
            deleteSkill(config.getAgentSkillsPath(req.params.name as string), req.params.skillName as string)));

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
            const saver = new AgentSqliteSaver(userId, config.getUserSaverPath(userId));
            const messages = await saver.getAllMessages();
            await saver.dispose();
            return messages.map(m => {
                const mm = m as any;
                const role = mm._getType?.() ?? 'unknown';
                const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
                const result: any = { role, content };
                if (mm.tool_calls?.length) result.tool_calls = mm.tool_calls;
                if (mm.tool_call_id) result.tool_call_id = mm.tool_call_id;
                if (mm.name) result.name = mm.name;
                return result;
            });
        }));

        app.delete('/api/users/:userId/history', api(async req => {
            const userId = req.params.userId as string;
            const saver = new AgentSqliteSaver(userId, config.getUserSaverPath(userId));
            await saver.clearMessages();
            await saver.dispose();
            LarkUserService.allUsers.delete(userId);
            WebUserService.allUsers.delete(userId);
        }));

        // ===== 长期记忆 =====
        app.get('/api/users/:userId/memory', api(async req => {
            const userId = req.params.userId as string;
            const db = new MemorySqliteDatabase(userId, config.getUserMemoryPath(userId));
            return (await db.getAllMemories()).map(m => ({
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

        app.delete('/api/users/:userId/memory/:memoryId', api(async req => {
            const userId = req.params.userId as string;
            const memoryId = req.params.memoryId as string;
            const db = new MemorySqliteDatabase(userId, config.getUserMemoryPath(userId));
            db.deleteMemory(memoryId);
        }));

        app.delete('/api/users/:userId/memory', api(async req => {
            const userId = req.params.userId as string;
            const db = new MemorySqliteDatabase(userId, config.getUserMemoryPath(userId));
            const count = await db.clearMemories();
            return { count };
        }));

        // ===== Web 聊天（SSE 流式）=====
        app.post('/api/users/:userId/chat', (req, res) => {
            const userId = req.params.userId as string;
            const { query } = req.body;
            if (!query?.trim()) {
                res.status(400).json({ success: false, message: '消息不能为空' });
                return;
            }
            const service = WebUserService.getUser(userId);
            WebUserService.sendSSE(res, emit => service.onReceiveWebMessage(query.trim(), emit));
        });

        // ===== 操作 =====
        app.post('/api/reload', api(() => {
            config.reloadSettings();
            LarkUserService.allUsers.clear();
            WebUserService.allUsers.clear();
            return { message: '配置已重载' };
        }));

        http.createServer(app).listen(port, () => {
            logger.info(`HTTP 服务启动成功: http://127.0.0.1:${port}`);
        });
    }
}

export const httpServer = new HttpServer();
