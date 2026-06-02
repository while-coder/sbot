import os from 'os';
import { type StructuredToolInterface } from '@langchain/core/tools';
import {
    ServiceContainer,
    IAgentCallback,
    ILoggerService,
    IMemoryService, IMemoryDatabase,
    MemoryService,
    IEmbeddingService,
    IAgentSaverService,
    T_MemorySystemPromptTemplate,
    T_MemoryToolDescs,
    IModelService,
    IWikiService, IWikiDatabase,
    WikiService,
    T_WikiSystemPromptTemplate,
    T_WikiToolDescs,
    IInsightService, InsightService,
    IInsightExtractor, InsightExtractor,
    T_InsightDir,
    T_InsightExtractorSystemPrompt,
    T_InsightStaleDays, T_InsightArchiveDays, T_InsightSystemPromptTemplate,
    ITodoService, TodoService,
    ITodoExtractor, TodoExtractor,
    T_TodoFilePath,
    T_TodoExtractorSystemPrompt,
    T_TodoToolDescs,
    type MessageContent,
} from "scorpio.ai";
import { loadPrompt } from "../Core/PromptLoader";
import { config, InsightScope, TodoScope, type ToolAgentEntry } from "../Core/Config";
import { discoverContextFiles } from "../Core/ContextFileDiscovery";

import { AgentFactory } from "./AgentFactory";
import { LoggerService } from "../Core/LoggerService";
import { sessionManager } from "../Session/SessionManager";
import { MemoryDatabaseManager } from "./MemoryDatabaseManager";
import { WikiDatabaseManager } from "./WikiDatabaseManager";
import { SaverPool } from "./SaverPool";

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
        await AgentRunner.registerInsightService(container, agentId, threadId);
        await AgentRunner.registerTodoService(container, agentId, threadId);

        const saverHandle = await SaverPool.getInstance().acquire(saverId, threadId);
        container.registerInstance(IAgentSaverService, saverHandle.saver);

        const agent = await AgentFactory.create({ agentId, container, extraPrompts, dynamicPrompts, agentTools, dbSessionId, workPath });
        try {
            await agent.stream(query, callbacks, signal);
        } finally {
            await agent.dispose();
            await saverHandle.release();
        }
    }

    static async createMemoryService(memoryId: string): Promise<IMemoryService> {
        const service = await AgentRunner.buildMemoryService(memoryId);
        if (!service) throw new Error(`Memory config "${memoryId}" not found or missing embedding`);
        return service;
    }

    private static async buildMemoryService(memoryId: string, loggerService?: LoggerService): Promise<IMemoryService | null> {
        const memoryConfig = config.getMemory(memoryId);
        if (!memoryConfig?.embedding) return null;

        const embedding = await config.getEmbeddingService(memoryConfig.embedding, true);

        const sub = new ServiceContainer();
        if (loggerService) sub.registerInstance(ILoggerService, loggerService);
        const dbPath = config.getMemoryDBPath(memoryId);
        sub.registerInstance(IMemoryDatabase, MemoryDatabaseManager.getInstance().acquire(dbPath));

        sub.registerWithArgs(IMemoryService, MemoryService, {
            [IEmbeddingService]: embedding,
            [T_MemorySystemPromptTemplate]: loadPrompt('memory/system.txt'),
            [T_MemoryToolDescs]: { search: loadPrompt('tools/memory/search.txt') },
        });

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

        const args: Record<string | symbol, any> = {
            [T_WikiSystemPromptTemplate]: loadPrompt('wiki/system.txt'),
            [T_WikiToolDescs]: {
                search: loadPrompt('tools/wiki/search.txt'),
                read: loadPrompt('tools/wiki/read.txt'),
            },
        };

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
        }
    }

    private static async registerInsightService(
        container: ServiceContainer,
        agentName: string,
        threadId: string,
    ): Promise<void> {
        const agentEntry = config.getAgent(agentName) as ToolAgentEntry;
        const insightConfig = agentEntry.insight;
        if (!insightConfig || insightConfig.scope === InsightScope.Disabled) return;

        const insightDir = insightConfig.scope === InsightScope.Session
            ? config.getSessionInsightsPath(threadId)
            : config.getAgentInsightsPath(agentName);

        const extractorModel = await config.getModelService(insightConfig.extractor, true);
        container.registerWithArgs(IInsightExtractor, InsightExtractor, {
            [IModelService]: extractorModel,
            [T_InsightExtractorSystemPrompt]: loadPrompt(insightConfig.extractorPromptFile ?? 'insight/extractor/default.txt'),
        });

        container.registerWithArgs(IInsightService, InsightService, {
            [T_InsightDir]: insightDir,
            [T_InsightSystemPromptTemplate]: loadPrompt('insight/system.txt'),
            [T_InsightStaleDays]: 30,
            [T_InsightArchiveDays]: 90,
        });
    }

    private static async registerTodoService(
        container: ServiceContainer,
        agentName: string,
        threadId: string,
    ): Promise<void> {
        const agentEntry = config.getAgent(agentName) as ToolAgentEntry;
        const todoConfig = agentEntry.todo;
        if (!todoConfig || todoConfig.scope === TodoScope.Disabled) return;

        const filePath = config.getSessionTodoPath(threadId);

        const extractorModel = await config.getModelService(todoConfig.extractor, true);
        container.registerWithArgs(ITodoExtractor, TodoExtractor, {
            [IModelService]: extractorModel,
            [T_TodoExtractorSystemPrompt]: loadPrompt(todoConfig.extractorPromptFile ?? 'todo/extractor/default.txt'),
        });

        container.registerWithArgs(ITodoService, TodoService, {
            [T_TodoFilePath]: filePath,
            [T_TodoToolDescs]: { list: loadPrompt('tools/todo/list.txt') },
        });
    }
}
