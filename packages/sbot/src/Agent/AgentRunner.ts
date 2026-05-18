import os from 'os';
import { type StructuredToolInterface } from '@langchain/core/tools';
import {
    ServiceContainer,
    IAgentCallback,
    ILoggerService,
    IMemoryService, IMemoryDatabase,
    MemoryService,
    IEmbeddingService,
    IAgentSaverService, AgentFileSaver, AgentSqliteSaver, AgentMemorySaver,
    T_DBPath,
    T_MemorySystemPromptTemplate,
    IModelService,
    IWikiService, IWikiDatabase,
    WikiService,
    T_WikiSystemPromptTemplate,
    type MessageContent,
} from "scorpio.ai";
import { loadPrompt } from "../Core/PromptLoader";
import { config, SaverType } from "../Core/Config";
import { discoverContextFiles } from "../Core/ContextFileDiscovery";

import { AgentFactory } from "./AgentFactory";
import { LoggerService } from "../Core/LoggerService";
import { sessionManager } from "../Session/SessionManager";
import { MemoryDatabaseManager } from "./MemoryDatabaseManager";
import { WikiDatabaseManager } from "./WikiDatabaseManager";

const logger = LoggerService.getLogger('AgentRunner.ts');

export interface AgentRunOptions {
    /** 用户输入的消息 */
    query: MessageContent;
    /** Agent 运行期间的消息回调（流式输出、工具调用确认等） */
    callbacks: IAgentCallback;
    /** 要运行的 Agent 配置 ID */
    agentId: string;
    /** 历史记录存储器配置 ID */
    saverId: string;
    /** 会话唯一标识，同时用作 saver threadId 和 session 管理 key */
    threadId: string;
    /** 注入 environment 块的额外信息（用户信息等特定渠道独有字段） */
    extraInfo: string;
    /** 记忆服务配置 ID 列表，不传则不启用记忆 */
    memories?: string[];
    /** Wiki 知识库配置 ID 列表 */
    wikis?: string[];
    /** Agent 文件操作根目录，不传则默认为 assets/{threadId} */
    workPath?: string;
    /** 动态注册到 Agent 的工具列表 */
    agentTools?: StructuredToolInterface[];
    /** 归属会话 DB 主键（channel_session.id） */
    dbSessionId: string;
}

export class AgentRunner {
    static async run(options: AgentRunOptions): Promise<void> {
        const { query, callbacks, agentId, saverId, threadId, dbSessionId, extraInfo, memories, wikis, agentTools } = options;
        if (!agentId.trim())   throw new Error("agent not specified");
        if (!saverId.trim())   throw new Error("saver not specified");
        if (!threadId.trim())  throw new Error("threadId not specified");

        const signal = sessionManager.getOrCreate(threadId).signal;
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const assetsDir = config.getConfigPath('assets', true);
        const httpUrl = config.getHttpUrl();
        const workPath = options.workPath ?? `${assetsDir}/${threadId}`;

        /** 静态 system prompts（可缓存）：instruction → environment */
        const extraPrompts: string[] = [
            loadPrompt('system/instruction.txt'),
            loadPrompt('system/environment.txt', {
                timezone,
                os: `${os.type()} ${os.release()} (${os.platform()})`,
                assetsDir,
                httpUrl,
                workPath,
            }),
        ];

        /** 动态 system prompts（每次请求变化，不可缓存） */
        const dynamicPrompts: string[] = [
            ...(extraInfo?.trim() ? [extraInfo] : []),
        ];

        // 目录级上下文自动发现（.sbot.md / SBOT.md）
        const contextFiles = discoverContextFiles(workPath);
        if (contextFiles.length > 0) {
            const contextContent = contextFiles
                .map(c => `<workspace-context source="${c.path}">\n${c.content}\n</workspace-context>`)
                .join('\n');
            dynamicPrompts.push(contextContent);
        }

        const container = new ServiceContainer();
        container.registerInstance(ILoggerService, { getLogger: (name: string) => LoggerService.getLogger(name) });
        await AgentRunner.registerMemoryServices(container, memories ?? []);
        await AgentRunner.registerWikiServices(container, wikis ?? []);
        await AgentRunner.registerSaverService(container, saverId, threadId);

        const agent = await AgentFactory.create({ agentId, container, extraPrompts, dynamicPrompts, agentTools, dbSessionId, workPath });
        try {
            await agent.stream(query, callbacks, signal);
        } finally {
            await agent.dispose();
        }
    }

    static async createMemoryService(memoryId: string): Promise<IMemoryService> {
        const service = await AgentRunner.buildMemoryService(memoryId);
        if (!service) throw new Error(`Memory config "${memoryId}" not found or missing embedding`);
        return service;
    }

    static async createSaverService(saverId: string, threadId: string): Promise<IAgentSaverService> {
        const container = new ServiceContainer();
        await AgentRunner.registerSaverService(container, saverId, threadId);
        return container.resolve<IAgentSaverService>(IAgentSaverService);
    }

    private static async buildMemoryService(memoryId: string, loggerService?: LoggerService): Promise<IMemoryService | null> {
        const memoryConfig = config.getMemory(memoryId);
        if (!memoryConfig?.embedding) return null;

        const embedding = await config.getEmbeddingService(memoryConfig.embedding, true);

        const sub = new ServiceContainer();
        if (loggerService) sub.registerInstance(ILoggerService, loggerService);
        const dbPath = config.getMemoryDBPath(memoryId);
        sub.registerInstance(IMemoryDatabase, MemoryDatabaseManager.getInstance().acquire(dbPath));

        sub.registerWithArgs(IMemoryService, MemoryService, { [IEmbeddingService]: embedding });

        return sub.resolve<IMemoryService>(IMemoryService);
    }

    private static async registerMemoryServices(
        container: ServiceContainer,
        memories: string[],
    ): Promise<void> {
        const loggerService = container.isRegistered(ILoggerService) ? await container.resolve<LoggerService>(ILoggerService) : undefined
        const results = await Promise.all(memories.map(memoryId => AgentRunner.buildMemoryService(memoryId, loggerService)));
        const services = results.filter((s): s is IMemoryService => s !== null);
        if (services.length > 0) {
            container.registerInstance(IMemoryService, services);
            container.registerInstance(T_MemorySystemPromptTemplate, loadPrompt('memory/system.txt'));
        }
    }

    static async createWikiService(wikiId: string): Promise<IWikiService> {
        const service = await AgentRunner.buildWikiService(wikiId);
        if (!service) throw new Error(`Wiki config "${wikiId}" not found`);
        return service;
    }

    private static async buildWikiService(wikiId: string): Promise<IWikiService | null> {
        const wikiConfig = config.getWiki(wikiId);
        if (!wikiConfig) return null;

        const sub = new ServiceContainer();
        const wikiDir = config.getWikiDBPath(wikiId);
        sub.registerInstance(IWikiDatabase, WikiDatabaseManager.getInstance().acquire(wikiDir));

        const args: Record<string | symbol, any> = { [T_DBPath]: wikiDir };
        if (wikiConfig.embedding) {
            try {
                const embedding = await config.getEmbeddingService(wikiConfig.embedding, true);
                args[IEmbeddingService] = embedding;
            } catch { /* embedding unavailable, graceful fallback */ }
        }

        sub.registerWithArgs(IWikiService, WikiService, args);
        return sub.resolve<IWikiService>(IWikiService);
    }

    private static async registerWikiServices(
        container: ServiceContainer,
        wikis: string[],
    ): Promise<void> {
        if (wikis.length === 0) return;
        const results = await Promise.all(wikis.map(wikiId => AgentRunner.buildWikiService(wikiId)));
        const services = results.filter((s): s is IWikiService => s !== null);
        if (services.length > 0) {
            container.registerInstance(IWikiService, services);
            container.registerInstance(T_WikiSystemPromptTemplate, loadPrompt('wiki/system.txt'));
        }
    }

    private static async registerSaverService(
        container: ServiceContainer,
        saverId: string,
        saverThreadId: string,
    ): Promise<void> {
        if (container.isRegistered(IAgentSaverService)) return
        const saverConfig = config.getSaver(saverId);
        if (saverConfig === undefined) {
            return;
        }

        const dbThreadId = saverConfig.share ? saverId : saverThreadId;

        if (saverConfig.type === SaverType.Memory) {
            container.registerSingleton(IAgentSaverService, AgentMemorySaver);
        } else if (saverConfig.type === SaverType.File) {
            container.registerWithArgs(IAgentSaverService, AgentFileSaver, {
                [T_DBPath]: config.getSaverDBPath(saverId, dbThreadId, '.json'),
            });
        } else {
            container.registerWithArgs(IAgentSaverService, AgentSqliteSaver, {
                [T_DBPath]: config.getSaverDBPath(saverId, dbThreadId, '.db'),
            });
        }
    }
}
