import express from 'express';
import http from 'http';
import path from 'path';
import { config, isDev } from '../Core/Config';
import { ACPAgentPool } from '../Agent/ACPAgentPool';
import { SkillHubService } from '../SkillHub';
import { AgentStoreService } from '../AgentStore';
import { LoggerService, log4js } from '../Core/LoggerService';
import { database } from '../Core/Database';
import { agendaStorePool, agendaTriggerEnginePool } from '../Agenda';
import { channelManager } from '../Channel/ChannelManager';
import { tunnelService } from '../Tunnel';
import { WEB_CHANNEL_ID } from 'sbot.commons';
import { webService } from '../Channel/web/WebService';
import { ptyService, listShells } from '../Channel/web/PtyService';
import { api } from '../utils';

import type { RouteContext } from './routes/types';
import { systemRoutes } from './routes/system';
import { settingsRoutes } from './routes/settings';
import { filesystemRoutes } from './routes/filesystem';
import { mcpRoutes } from './routes/mcp';
import { skillRoutes } from './routes/skills';
import { skillHubRoutes } from './routes/skillHub';
import { agentStoreRoutes } from './routes/agentStore';
import { promptRoutes } from './routes/prompts';
import { dataRoutes } from './routes/data';
import { agendaRoutes } from './routes/agendas';
import { memoryRoutes } from './routes/memories';
import { heartbeatRoutes } from './routes/heartbeats';
import { userRoutes } from './routes/users';
import { logRoutes } from './routes/logs';
import { chatRoutes } from './routes/chat';
import { tunnelRoutes } from './routes/tunnel';

const logger = LoggerService.getLogger('HttpServer.ts');

class HttpServer {
    private readonly skillHubService = new SkillHubService();
    private readonly agentStoreService = new AgentStoreService();
    private server?: http.Server;

    async shutdown(): Promise<void> {
        logger.info('Shutting down services...');
        try {
            agendaTriggerEnginePool.stopAll();
            agendaStorePool.disposeAll();
            await ACPAgentPool.getInstance().disposeAll();
            await channelManager.dispose();
            ptyService.dispose();
            try { await tunnelService.stopAll(); } catch (e: any) {
                logger.warn(`tunnel stop error: ${e?.message ?? e}`);
            }
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
        const outgoingDir = config.getConfigPath('outgoing', true);

        const ctx: RouteContext = {
            skillHubService: this.skillHubService,
            agentStoreService: this.agentStoreService,
            settingsWithAgents: () => this.settingsWithAgents(),
            shutdown: () => this.shutdown(),
        };

        // 注册顺序与原 HttpServer 内部 registerXxxRoutes 调用顺序保持一致；
        // settings.ts 内部会再调用 agents.ts / acp.ts（settings → agents → acp → channels CRUD → sessions）。
        systemRoutes.register(app, ctx);
        settingsRoutes.register(app, ctx);
        filesystemRoutes.register(app, ctx);
        mcpRoutes.register(app, ctx);
        skillRoutes.register(app, ctx);
        skillHubRoutes.register(app, ctx);
        agentStoreRoutes.register(app, ctx);
        promptRoutes.register(app, ctx);
        dataRoutes.register(app, ctx);
        agendaRoutes.register(app, ctx);
        memoryRoutes.register(app, ctx);
        heartbeatRoutes.register(app, ctx);
        logRoutes.register(app, ctx);
        userRoutes.register(app, ctx);
        chatRoutes.register(app, ctx);
        tunnelRoutes.register(app, ctx);

        app.get('/api/pty/shells', api(() => listShells()));

        // HTTP + WebSocket 服务：把 ws 升级路径与 web channel 运行时交给 WebService，
        // 然后注册到 channelManager，让消息出路与 dispose 生命周期与其他 channel 对齐
        const server = this.server = http.createServer(app);
        webService.attach(server, uploadDir, outgoingDir);
        ptyService.attach(server);
        channelManager.registerService(WEB_CHANNEL_ID, webService);

        server.listen(port, () => {
            logger.info(`HTTP server started, admin UI available at: http://127.0.0.1:${port}`);
        });

    }
}

export const httpServer = new HttpServer();
