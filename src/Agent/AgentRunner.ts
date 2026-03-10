import os from 'os';
import {
    ServiceContainer,
    IAgentCallback,
    ILoggerService,
    IMemoryService, IMemoryDatabase, MemorySqliteDatabase,
    MemoryEvaluator, MemoryCompressor, MemoryExtractor, MemoryService, MemoryNoneService,
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
            `当前时间：${now.toLocaleString('zh-CN', { timeZone: timezone, hour12: false })}
时区：${timezone}
操作系统：${os.type()} ${os.release()} (${os.platform()})
系统语言：${process.env.LANG || Intl.DateTimeFormat().resolvedOptions().locale || 'zh-CN'}
生成供用户查看或下载的文件时，将文件保存至 ${assetsDir}，并以 ${httpUrl}/assets/<文件名> 形式提供访问地址。
临时脚本文件存放至 ${scriptsDir}。`,
        ];
        if (workPath) {
            extraPrompts.push(`工作目录：${workPath}`);
        }
        if (userInfo) {
            extraPrompts.push(`用户user_id:${userInfo.user_id}
用户open_id:${userInfo.open_id}
用户union_id:${userInfo.union_id}
用户姓名:${userInfo.name}
用户邮箱:${userInfo.email}`);
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
