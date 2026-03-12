import os from 'os';
import {
    ServiceContainer,
    IAgentCallback,
    ILoggerService,
    IMemoryService, IMemoryDatabase, MemorySqliteDatabase,
    MemoryEvaluator, MemoryCompressor, MemoryExtractor, MemoryService,
    IEmbeddingService,
    IMemoryExtractor, IMemoryEvaluator, IMemoryCompressor,
    IAgentSaverService, AgentSqliteSaver, 
    T_MaxMemoryAgeDays, T_MemoryMode, T_DBPath, T_ThreadId,
    IModelService,
} from "scorpio.ai";
import { AgentFileSaver } from "scorpio.ai/dist/Saver";
import { config, SaverType } from "../Core/Config";
import { ContextType } from "../Core/Database";
import { AgentFactory } from "./AgentFactory";
import { LoggerService } from "../Core/LoggerService";

const logger = LoggerService.getLogger('AgentRunner.ts');

export class AgentRunner {
    static async run(
        query: string,
        callbacks: IAgentCallback,
        agentId: string,
        saverId: string,
        saverThreadId: string,
        contextType: ContextType,
        memoryId?: string,
        userInfo?: any,
        workPath?: string,
    ): Promise<void> {
        if (!agentId.trim())        throw new Error("未指定 agent");
        if (!saverId.trim())        throw new Error("未指定 saver");
        if (!saverThreadId.trim())  throw new Error("未指定 saverThreadId");

        const now = new Date();
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const assetsDir = config.getConfigPath('assets', true);
        const scriptsDir = config.getConfigPath('scripts', true);
        const httpUrl = config.getHttpUrl();
        if (!workPath) {
            workPath = `${assetsDir}/${saverThreadId}`;
        }
        // 在 session 模式下，从 saverThreadId 中还原出原始 sessionId，供调度工具使用
        const schedulerSessionId = (contextType === ContextType.Session && saverThreadId.startsWith('session_'))
            ? saverThreadId.slice('session_'.length)
            : null;

        const extraPrompts: string[] = [
            `<environment>
  <current-time>${now.toLocaleString(undefined, { timeZone: timezone, hour12: false })}</current-time>
  <timezone>${timezone}</timezone>
  <os>${os.type()} ${os.release()} (${os.platform()})</os>
  <locale>${process.env.LANG || Intl.DateTimeFormat().resolvedOptions().locale}</locale>
  <conversation-type>${contextType}</conversation-type>
  <scheduler-session-id>${schedulerSessionId ?? ''}</scheduler-session-id>
  <paths>
    <assets dir="${assetsDir}" url="${httpUrl}/assets/&lt;filename&gt;">IMPORTANT: This is the ONLY way to deliver files to users. Whenever you generate, export, or produce any file intended for the user (images, documents, archives, reports, etc.), you MUST save it to this directory and share the URL above. Never send raw file content inline, never use any other path or method.</assets>
    <scripts dir="${scriptsDir}">Store temporary scripts here</scripts>
    <working-directory dir="${workPath}">All file operations (create, write, delete, move) must stay within this directory. Never access, modify, or delete files outside it.</working-directory>
  </paths>
</environment>`,
        ];
        if (userInfo) {
            extraPrompts.push(`<current-user>
  <db-id>${userInfo.dbUserId ?? ''}</db-id>       
  <id>${userInfo.user_id}</id>
  <open-id>${userInfo.open_id}</open-id>
  <union-id>${userInfo.union_id}</union-id>
  <name>${userInfo.name}</name>
  <email>${userInfo.email}</email>
</current-user>`);
        }

        const container = new ServiceContainer();
        container.registerInstance(ILoggerService, { getLogger: (name: string) => LoggerService.getLogger(name) });
        await AgentRunner.registerMemoryService(container, memoryId);
        await AgentRunner.registerSaverService(container, saverId, saverThreadId);

        const agent = await AgentFactory.create(agentId, container, true, extraPrompts);
        try {
            await agent.stream(query, callbacks);
        } finally {
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
            const e: any = new Error(`记忆配置 "${memoryId}" 不存在`);
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
            });
        }
        const extractorModel = await config.getModelService(memoryConfig.extractor);
        if (extractorModel) {
            container.registerWithArgs(IMemoryExtractor, MemoryExtractor, {
                [IModelService]: extractorModel,
            });
        }
        const compressorModel = await config.getModelService(memoryConfig.compressor);
        if (compressorModel) {
            container.registerWithArgs(IMemoryCompressor, MemoryCompressor, {
                [IModelService]: compressorModel,
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
