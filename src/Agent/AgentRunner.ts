import os from 'os';
import path from 'path';
import {
    ServiceContainer,
    IAgentCallback,
    ILoggerService,
    IMemoryService, IMemoryDatabase, MemorySqliteDatabase,
    MemoryEvaluator, MemoryCompressor, MemoryExtractor, MemoryService, MemoryNoneService,
    IEmbeddingService,
    IMemoryExtractor, IMemoryEvaluator, IMemoryCompressor,
    IAgentSaverService, AgentSqliteSaver, AgentMemorySaver,
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
        agentName: string,
        saverName: string,
        saverThreadId: string,
        userInfo?: any,
        memoryName?: string,
    ): Promise<void> {
        if (!agentName.trim())      throw new Error("未指定 agent");
        if (!saverName.trim())      throw new Error("未指定 saver");
        if (!saverThreadId.trim())  throw new Error("未指定 saverThreadId");
        const agentEntry = config.settings.agents?.[agentName];
        if (!agentEntry) throw new Error(`Agent 配置 "${agentName}" 不存在，请检查 settings.json 中的 agents 配置`);

        const now = new Date();
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const assetsDir = path.resolve(__dirname, '../../assets');
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
        if (userInfo) {
            extraPrompts.push(`用户user_id:${userInfo.user_id}
用户open_id:${userInfo.open_id}
用户union_id:${userInfo.union_id}
用户姓名:${userInfo.name}
用户邮箱:${userInfo.email}`);
        }

        const container = new ServiceContainer();
        container.registerInstance(ILoggerService, { getLogger: (name: string) => LoggerService.getLogger(name) });
        await AgentRunner.registerMemoryService(container, memoryName);
        await AgentRunner.registerSaverService(container, saverName, saverThreadId);

        logger.info(`使用 Agent [${agentName}] (${agentEntry.type})`);

        const agent = await AgentFactory.create(agentName, container, true, extraPrompts);
        try {
            await agent.stream(query, callbacks);
        } finally {
            await agent.dispose();
        }
    }

    static async createMemoryService(memoryName: string): Promise<IMemoryService> {
        const container = new ServiceContainer();
        await AgentRunner.registerMemoryService(container, memoryName);
        return container.resolve<IMemoryService>(IMemoryService);
    }

    static async createSaverService(saverName: string): Promise<IAgentSaverService> {
        const container = new ServiceContainer();
        await AgentRunner.registerSaverService(container, saverName);
        return container.resolve<IAgentSaverService>(IAgentSaverService);
    }

    private static async registerMemoryService(
        container: ServiceContainer,
        memoryName?: string,
    ): Promise<void> {
        if (container.isRegistered(IMemoryService)) return;
        const memoryConfig = config.getMemory(memoryName);
        if (!memoryConfig?.embedding) {
            container.registerSingleton(IMemoryService, MemoryNoneService);
            return;
        }

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
            [T_ThreadId]: memoryName,
            [T_DBPath]: config.getMemoryPath(memoryName!),
        });
        container.registerWithArgs(IMemoryService, MemoryService, {
            [IEmbeddingService]: await config.getEmbeddingService(memoryConfig.embedding, true),
            [T_MaxMemoryAgeDays]: memoryConfig.maxAgeDays,
            [T_MemoryMode]: memoryConfig.mode,
        });
    }

    private static async registerSaverService(
        container: ServiceContainer,
        saverName?: string,
        threadId?: string,
    ): Promise<void> {
        if (container.isRegistered(IAgentSaverService)) return;
        const saverConfig = config.getSaver(saverName);
        if (saverConfig === undefined) {
            container.registerSingleton(IAgentSaverService, AgentMemorySaver);
            return;
        }

        const tid = threadId ?? saverName;
        if (saverConfig.type === SaverType.File) {
            container.registerWithArgs(IAgentSaverService, AgentFileSaver, {
                [T_ThreadId]: tid,
                [T_DBPath]: config.getSaverDir(saverName!),
            });
        } else {
            container.registerWithArgs(IAgentSaverService, AgentSqliteSaver, {
                [T_ThreadId]: tid,
                [T_DBPath]: config.getSaverPath(saverName!),
            });
        }
    }
}
