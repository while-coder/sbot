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
        userInfo?: any,
        memoryId?: string,
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
        const extraPrompts: string[] = [
            `## Environment
- **Current time:** ${now.toLocaleString(undefined, { timeZone: timezone, hour12: false })}
- **Timezone:** ${timezone}
- **OS:** ${os.type()} ${os.release()} (${os.platform()})
- **System locale:** ${process.env.LANG || Intl.DateTimeFormat().resolvedOptions().locale}

## File Paths
- **Assets directory:** ${assetsDir} — when generating files for the user to view or download, save here and serve via \`${httpUrl}/assets/<filename>\`
- **Scripts directory:** ${scriptsDir} — store temporary scripts here`,
        ];
        if (workPath) {
            extraPrompts.push(`- **Working Directory**: ${workPath}`);
        }
        if (userInfo) {
            extraPrompts.push(`## Current User
- **ID:** ${userInfo.user_id}
- **Open ID:** ${userInfo.open_id}
- **Union ID:** ${userInfo.union_id}
- **Name:** ${userInfo.name}
- **Email:** ${userInfo.email}`);
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
