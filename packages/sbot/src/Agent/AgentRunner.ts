import os from 'os';
import path from 'path';
import { z } from 'zod';
import { DynamicStructuredTool } from '@langchain/core/tools';
import {
    ServiceContainer,
    IAgentCallback,
    ILoggerService,
    IMemoryService, IMemoryDatabase,
    MemoryEvaluator, MemoryCompressor, MemoryExtractor, MemoryService,
    IEmbeddingService,
    IMemoryExtractor, IMemoryEvaluator, IMemoryCompressor,
    IAgentSaverService, AgentFileSaver, AgentSqliteSaver,
    T_MaxMemoryAgeDays, T_MemoryMode, T_DBPath,
    T_ExtractorSystemPrompt, T_EvaluatorSystemPrompt, T_CompressorPromptTemplate,
    T_MemorySystemPromptTemplate,
    IModelService,
    IWikiService, IWikiDatabase,
    WikiExtractor, WikiService,
    IWikiExtractor,
    T_WikiExtractorSystemPrompt, T_WikiAutoExtract,
    createAskTool, type AskUserFn, AskQuestionType,
    type MessageContent,
} from "scorpio.ai";
import { loadPrompt } from "../Core/PromptLoader";
import { config, SaverType } from "../Core/Config";
import { SchedulerType } from "../Core/Database";

import { AgentFactory } from "./AgentFactory";
import { LoggerService } from "../Core/LoggerService";
import { sessionManager } from "../UserService/SessionManager";
import { MemoryDatabaseManager } from "./MemoryDatabaseManager";
import { WikiDatabaseManager } from "./WikiDatabaseManager";

const logger = LoggerService.getLogger('AgentRunner.ts');

/** 动态注册到 Agent 的工具描述 */
export interface AgentTool {
    /** 工具唯一标识，用于 registerToolFactory 的 key */
    name: string;
    /** 工具工厂函数，返回工具实例列表 */
    factory: () => Promise<any[]> | any[];
}

/** 发送文件的函数签名，由具体渠道实现并传入 */
export type SendFileFn = (filePath: string, fileName: string) => Promise<void>;

export const SEND_FILE_TOOL_NAME = '_send_file';

/** 创建 send_file 工具 */
export function createSendFileAgentTool(prompt: string, sendFileFn: SendFileFn): AgentTool {
    return {
        name: "__send_file__",
        factory: () => [new DynamicStructuredTool({
            name: SEND_FILE_TOOL_NAME,
            description: prompt,
            schema: z.object({
                file_path: z.string().describe('Absolute path of the local file to send'),
                file_name: z.string().optional().describe('File name with extension; defaults to the basename of file_path'),
            }),
            func: async ({ file_path, file_name }) => {
                const name = file_name ?? path.basename(file_path);
                await sendFileFn(file_path, name);
                return `File "${name}" sent successfully`;
            },
        })],
    };
}

/** 创建 ask 交互工具（封装 createAskTool） */
export function createAskAgentTool(prompt: string, askFn: AskUserFn, supportedTypes?: AskQuestionType[]): AgentTool {
    return {
        name: '__ask__',
        factory: async () => [createAskTool(askFn, prompt, supportedTypes)],
    };
}

/** 调度器上下文，标识本次运行归属的调度器 */
export interface AgentSchedulerContext {
    /** 调度器类型（Channel / Session） */
    schedulerType: SchedulerType;
    /** 调度器实例 ID（channelSessionId / sessionId） */
    schedulerId: string;
}

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
    agentTools?: AgentTool[];
    /** 调度器上下文 */
    scheduler: AgentSchedulerContext;
}

export class AgentRunner {
    static async run(options: AgentRunOptions): Promise<void> {
        const { query, callbacks, agentId, saverId, threadId, scheduler, extraInfo, memories, wikis, agentTools } = options;
        if (!agentId.trim())   throw new Error("agent not specified");
        if (!saverId.trim())   throw new Error("saver not specified");
        if (!threadId.trim())  throw new Error("threadId not specified");

        const cancellationToken = sessionManager.getOrCreate(threadId).source;
        const now = new Date();
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const assetsDir = config.getConfigPath('assets', true);
        const scriptsDir = config.getConfigPath('scripts', true);
        const httpUrl = config.getHttpUrl();
        const workPath = options.workPath ?? `${assetsDir}/${threadId}`;

        /** 注入到 system prompt 末尾的额外上下文片段，按顺序拼接 */
        const extraPrompts: string[] = [
            `<environment>
  <current-time>${now.toLocaleString(undefined, { timeZone: timezone, hour12: false })}</current-time>
  <timezone>${timezone}</timezone>
  <os>${os.type()} ${os.release()} (${os.platform()})</os>
  <paths>
    <assets dir="${assetsDir}" url="${httpUrl}/assets/&lt;filename&gt;">IMPORTANT: This is the ONLY way to deliver files to users. Whenever you generate, export, or produce any file intended for the user (images, documents, archives, reports, etc.), you MUST save it to this directory and share the URL above. Never send raw file content inline, never use any other path or method.</assets>
    <scripts dir="${scriptsDir}">Store temporary scripts here</scripts>
    <working-directory dir="${workPath}">All file operations (create, write, delete, move) must stay within this directory. Never access, modify, or delete files outside it.</working-directory>
    <skills>
      <agent-skills dir="${config.getAgentSkillsPath(agentId)}">Your dedicated skills directory. When using tools to install or create skills, always use this directory as the default target.</agent-skills>
      <global-skills dir="${config.getSkillsPath()}">Shared skills directory available to all agents. Only install here when the user explicitly requests installing to global skills.</global-skills>
    </skills>
  </paths>
  ${extraInfo}
</environment>`,
        ];

        const container = new ServiceContainer();
        container.registerInstance(ILoggerService, { getLogger: (name: string) => LoggerService.getLogger(name) });
        await AgentRunner.registerMemoryServices(container, memories ?? [], threadId);
        await AgentRunner.registerWikiServices(container, wikis ?? [], threadId);
        await AgentRunner.registerSaverService(container, saverId, threadId);

        const agent = await AgentFactory.create({ agentId, container, extraPrompts, agentTools, scheduler });
        try {
            await agent.stream(query, callbacks, cancellationToken);
        } finally {
            await agent.dispose();
        }
    }

    static async createMemoryService(memoryId: string, threadId?: string): Promise<IMemoryService> {
        const service = await AgentRunner.buildMemoryService(memoryId, threadId ?? memoryId);
        if (!service) throw new Error(`Memory config "${memoryId}" not found or missing embedding`);
        return service;
    }

    static async createSaverService(saverId: string, threadId: string): Promise<IAgentSaverService> {
        const container = new ServiceContainer();
        await AgentRunner.registerSaverService(container, saverId, threadId);
        return container.resolve<IAgentSaverService>(IAgentSaverService);
    }

    private static async buildMemoryService(memoryId: string, memoryThreadId: string, loggerService?: LoggerService): Promise<IMemoryService | null> {
        const memoryConfig = config.getMemory(memoryId);
        if (!memoryConfig?.embedding) return null;

        const [evaluatorModel, extractorModel, compressorModel, embedding] = await Promise.all([
            config.getModelService(memoryConfig.evaluator),
            config.getModelService(memoryConfig.extractor),
            config.getModelService(memoryConfig.compressor),
            config.getEmbeddingService(memoryConfig.embedding, true),
        ]);

        const sub = new ServiceContainer();
        if (loggerService) sub.registerInstance(ILoggerService, loggerService)
        if (evaluatorModel) sub.registerWithArgs(IMemoryEvaluator, MemoryEvaluator, { [IModelService]: evaluatorModel, [T_EvaluatorSystemPrompt]: loadPrompt('memory/evaluator.txt') });
        if (extractorModel) sub.registerWithArgs(IMemoryExtractor, MemoryExtractor, { [IModelService]: extractorModel, [T_ExtractorSystemPrompt]: loadPrompt('memory/extractor.txt') });
        if (compressorModel) sub.registerWithArgs(IMemoryCompressor, MemoryCompressor, { [IModelService]: compressorModel, [T_CompressorPromptTemplate]: loadPrompt('memory/compressor.txt') });
        const memThreadId = memoryConfig.share ? memoryId : memoryThreadId;
        const dbPath = config.getMemoryDBPath(memoryId, memThreadId);
        sub.registerInstance(IMemoryDatabase, MemoryDatabaseManager.getInstance().acquire(dbPath));

        sub.registerWithArgs(IMemoryService, MemoryService, { [IEmbeddingService]: embedding, [T_MaxMemoryAgeDays]: memoryConfig.maxAgeDays, [T_MemoryMode]: memoryConfig.mode });

        return sub.resolve<IMemoryService>(IMemoryService);
    }

    private static async registerMemoryServices(
        container: ServiceContainer,
        memories: string[],
        memoryThreadId: string,
    ): Promise<void> {
        const loggerService = container.isRegistered(ILoggerService) ? await container.resolve<LoggerService>(ILoggerService) : undefined
        const results = await Promise.all(memories.map(memoryId => AgentRunner.buildMemoryService(memoryId, memoryThreadId, loggerService)));
        const services = results.filter((s): s is IMemoryService => s !== null);
        if (services.length > 0) {
            container.registerInstance(IMemoryService, services);
            container.registerInstance(T_MemorySystemPromptTemplate, loadPrompt('memory/system.txt'));
        }
    }

    static async createWikiService(wikiId: string, threadId?: string): Promise<IWikiService> {
        const service = await AgentRunner.buildWikiService(wikiId, threadId ?? wikiId);
        if (!service) throw new Error(`Wiki config "${wikiId}" not found`);
        return service;
    }

    private static async buildWikiService(
        wikiId: string,
        wikiThreadId: string,
        loggerService?: LoggerService
    ): Promise<IWikiService | null> {
        const wikiConfig = config.getWiki(wikiId);
        if (!wikiConfig) return null;

        const extractorModel = await config.getModelService(wikiConfig.extractor);

        const sub = new ServiceContainer();
        if (loggerService) sub.registerInstance(ILoggerService, loggerService);
        if (extractorModel) sub.registerWithArgs(IWikiExtractor, WikiExtractor, {
            [IModelService]: extractorModel,
            [T_WikiExtractorSystemPrompt]: loadPrompt('wiki/extractor.txt'),
        });

        const wikiThreadIdResolved = wikiConfig.share ? wikiId : wikiThreadId;
        const wikiDir = config.getWikiDBPath(wikiId, wikiThreadIdResolved);
        sub.registerInstance(IWikiDatabase, WikiDatabaseManager.getInstance().acquire(wikiDir));

        sub.registerWithArgs(IWikiService, WikiService, {
            [T_WikiAutoExtract]: wikiConfig.autoExtract !== false,
        });

        return sub.resolve<IWikiService>(IWikiService);
    }

    private static async registerWikiServices(
        container: ServiceContainer,
        wikis: string[],
        wikiThreadId: string,
    ): Promise<void> {
        if (wikis.length === 0) return;
        const loggerService = container.isRegistered(ILoggerService)
            ? await container.resolve<LoggerService>(ILoggerService)
            : undefined;
        const results = await Promise.all(
            wikis.map(wikiId => AgentRunner.buildWikiService(wikiId, wikiThreadId, loggerService))
        );
        const services = results.filter((s): s is IWikiService => s !== null);
        if (services.length > 0) {
            container.registerInstance(IWikiService, services);
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

        if (saverConfig.type === SaverType.File) {
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
