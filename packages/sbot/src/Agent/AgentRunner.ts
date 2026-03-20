import os from 'os';
import {
    ServiceContainer,
    IAgentCallback,
    ILoggerService,
    IMemoryService, IMemoryDatabase, MemorySqliteDatabase,
    MemoryEvaluator, MemoryCompressor, MemoryExtractor, MemoryService,
    IEmbeddingService,
    IMemoryExtractor, IMemoryEvaluator, IMemoryCompressor,
    IAgentSaverService, AgentFileSaver, AgentSqliteSaver,
    T_MaxMemoryAgeDays, T_MemoryMode, T_DBPath, T_ThreadId,
    T_ExtractorSystemPrompt, T_EvaluatorSystemPrompt, T_CompressorPromptTemplate,
    T_MemorySystemPromptTemplate,
    IModelService,
    type AskUserFn,
} from "scorpio.ai";
import { config, SaverType } from "../Core/Config";
import { loadPrompt } from "../Core/PromptLoader";
import { ContextType } from "../Core/Database";
import { AgentFactory } from "./AgentFactory";
import { LoggerService } from "../Core/LoggerService";
import { sessionManager } from "./SessionManager";

const logger = LoggerService.getLogger('AgentRunner.ts');

export interface AgentRunOptions {
    /** 用户输入的消息 */
    query: string;
    /** Agent 运行期间的消息回调（流式输出、工具调用确认等） */
    callbacks: IAgentCallback;
    /** 要运行的 Agent 配置 ID */
    agentId: string;
    /** 历史记录存储器配置 ID */
    saverId: string;
    /** 会话唯一标识，同时用作 saver threadId 和 session 管理 key */
    threadId: string;
    /** 会话上下文类型（Channel / Session / Directory） */
    contextType: ContextType;
    /** 注入 environment 块的额外信息（用户信息、scheduler-id 等） */
    extraInfo: string;
    /** 记忆服务配置 ID，不传则不启用记忆 */
    memoryId?: string;
    /** Agent 文件操作根目录，不传则默认为 assets/{threadId} */
    workPath?: string;
    /** 用户交互询问函数，由具体 UserService 实现并传入 */
    askFn?: AskUserFn;
}

export class AgentRunner {
    static async run(options: AgentRunOptions): Promise<void> {
        const { query, callbacks, agentId, saverId, threadId, contextType, extraInfo, memoryId, askFn } = options;
        if (!agentId.trim())   throw new Error("agent not specified");
        if (!saverId.trim())   throw new Error("saver not specified");
        if (!threadId.trim())  throw new Error("threadId not specified");

        const now = new Date();
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const assetsDir = config.getConfigPath('assets', true);
        const scriptsDir = config.getConfigPath('scripts', true);
        const httpUrl = config.getHttpUrl();
        const workPath = options.workPath ?? `${assetsDir}/${threadId}`;

        const extraPrompts: string[] = [
            `<environment>
  <current-time>${now.toLocaleString(undefined, { timeZone: timezone, hour12: false })}</current-time>
  <timezone>${timezone}</timezone>
  <os>${os.type()} ${os.release()} (${os.platform()})</os>
  <locale>${process.env.LANG || Intl.DateTimeFormat().resolvedOptions().locale}</locale>
  <conversation-type>${contextType}</conversation-type>
  <paths>
    <assets dir="${assetsDir}" url="${httpUrl}/assets/&lt;filename&gt;">IMPORTANT: This is the ONLY way to deliver files to users. Whenever you generate, export, or produce any file intended for the user (images, documents, archives, reports, etc.), you MUST save it to this directory and share the URL above. Never send raw file content inline, never use any other path or method.</assets>
    <scripts dir="${scriptsDir}">Store temporary scripts here</scripts>
    <working-directory dir="${workPath}">All file operations (create, write, delete, move) must stay within this directory. Never access, modify, or delete files outside it.</working-directory>
  </paths>
  ${extraInfo}
</environment>`,
        ];

        const container = new ServiceContainer();
        container.registerInstance(ILoggerService, { getLogger: (name: string) => LoggerService.getLogger(name) });
        await AgentRunner.registerMemoryService(container, memoryId);
        await AgentRunner.registerSaverService(container, saverId, threadId);

        const agent = await AgentFactory.create({ agentId, container, extraPrompts, askFn });
        const cancellationToken = sessionManager.start(threadId);
        try {
            await agent.stream(query, callbacks, cancellationToken);
        } finally {
            sessionManager.end(threadId);
            await agent.dispose();
        }
    }

    static async createMemoryService(memoryId: string): Promise<IMemoryService> {
        const container = new ServiceContainer();
        await AgentRunner.registerMemoryService(container, memoryId);
        return container.resolve<IMemoryService>(IMemoryService);
    }

    static async createMemoryDatabase(memoryId: string): Promise<IMemoryDatabase> {
        const memoryConfig = config.getMemory(memoryId);
        if (!memoryConfig) {
            const e: any = new Error(`Memory config "${memoryId}" not found`);
            e.status = 404;
            throw e;
        }
        const container = new ServiceContainer();
        container.registerWithArgs(IMemoryDatabase, MemorySqliteDatabase, {
            [T_ThreadId]: memoryId,
            [T_DBPath]: config.getMemoryPath(memoryId),
        });
        return container.resolve<IMemoryDatabase>(IMemoryDatabase);
    }

    static async createSaverService(saverId: string, threadId?: string): Promise<IAgentSaverService> {
        const container = new ServiceContainer();
        await AgentRunner.registerSaverService(container, saverId, threadId);
        return container.resolve<IAgentSaverService>(IAgentSaverService);
    }

    private static async registerMemoryService(
        container: ServiceContainer,
        memoryId?: string,
    ): Promise<void> {
        if (container.isRegistered(IMemoryService)) return
        if (!memoryId) return
        const memoryConfig = config.getMemory(memoryId);
        if (!memoryConfig?.embedding) return

        const evaluatorModel = await config.getModelService(memoryConfig.evaluator);
        if (evaluatorModel) {
            container.registerWithArgs(IMemoryEvaluator, MemoryEvaluator, {
                [IModelService]: evaluatorModel,
                [T_EvaluatorSystemPrompt]: loadPrompt('memory/evaluator.txt'),
            });
        }
        const extractorModel = await config.getModelService(memoryConfig.extractor);
        if (extractorModel) {
            container.registerWithArgs(IMemoryExtractor, MemoryExtractor, {
                [IModelService]: extractorModel,
                [T_ExtractorSystemPrompt]: loadPrompt('memory/extractor.txt'),
            });
        }
        const compressorModel = await config.getModelService(memoryConfig.compressor);
        if (compressorModel) {
            container.registerWithArgs(IMemoryCompressor, MemoryCompressor, {
                [IModelService]: compressorModel,
                [T_CompressorPromptTemplate]: loadPrompt('memory/compressor.txt'),
            });
        }
        container.registerWithArgs(IMemoryDatabase, MemorySqliteDatabase, {
            [T_ThreadId]: memoryId,
            [T_DBPath]: config.getMemoryPath(memoryId),
        });
        container.registerWithArgs(IMemoryService, MemoryService, {
            [IEmbeddingService]: await config.getEmbeddingService(memoryConfig.embedding, true),
            [T_MaxMemoryAgeDays]: memoryConfig.maxAgeDays,
            [T_MemoryMode]: memoryConfig.mode,
            [T_MemorySystemPromptTemplate]: loadPrompt('memory/system.txt'),
        });
    }

    private static async registerSaverService(
        container: ServiceContainer,
        saverId: string,
        saverThreadId?: string,
    ): Promise<void> {
        if (container.isRegistered(IAgentSaverService)) return
        const saverConfig = config.getSaver(saverId);
        if (saverConfig === undefined) {
            return;
        }

        const tid = saverThreadId ?? saverId;
        if (saverConfig.type === SaverType.File) {
            container.registerWithArgs(IAgentSaverService, AgentFileSaver, {
                [T_ThreadId]: tid,
                [T_DBPath]: config.getSaverDir(saverId),
            });
        } else {
            container.registerWithArgs(IAgentSaverService, AgentSqliteSaver, {
                [T_ThreadId]: tid,
                [T_DBPath]: config.getSaverPath(saverId),
            });
        }
    }
}
