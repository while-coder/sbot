import os from 'os';
import path from 'path';
import { z } from 'zod';
import { DynamicStructuredTool } from '@langchain/core/tools';
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
    createAskTool, type AskUserFn, AskQuestionType,
} from "scorpio.ai";
import { loadPrompt } from "../Core/PromptLoader";
import { config, SaverType } from "../Core/Config";
import { SchedulerType } from "../Core/Database";
import { ChannelType } from "sbot.commons";
import { AgentFactory } from "./AgentFactory";
import { LoggerService } from "../Core/LoggerService";
import { sessionManager } from "channel.base";

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
export function createSendFileAgentTool(channelType: ChannelType, sendFileFn: SendFileFn): AgentTool {
    const description = loadPrompt(`channels/${channelType}/send_file.txt`);
    return {
        name: "__send_file__",
        factory: () => [new DynamicStructuredTool({
            name: SEND_FILE_TOOL_NAME,
            description,
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

/** 创建 ask 交互工具（封装 createAskTool + prompt 加载） */
export function createAskAgentTool(channelType: ChannelType, askFn: AskUserFn, supportedTypes?: AskQuestionType[]): AgentTool {
    const promptPath = `channels/${channelType}/ask.txt`;
    return {
        name: '__ask__',
        factory: async () => [createAskTool(askFn, loadPrompt(promptPath), supportedTypes)],
    };
}

/** 调度器上下文，标识本次运行归属的调度器 */
export interface AgentSchedulerContext {
    /** 调度器类型（Channel / Session / Directory） */
    schedulerType: SchedulerType;
    /** 调度器实例 ID（channelSessionId / sessionId / workPath 等） */
    schedulerId: string;
}

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
    /** 注入 environment 块的额外信息（用户信息等特定渠道独有字段） */
    extraInfo: string;
    /** 记忆服务配置 ID，不传则不启用记忆 */
    memoryId?: string;
    /** Agent 文件操作根目录，不传则默认为 assets/{threadId} */
    workPath?: string;
    /** 动态注册到 Agent 的工具列表 */
    agentTools?: AgentTool[];
    /** 调度器上下文 */
    scheduler: AgentSchedulerContext;
}

export class AgentRunner {
    static async run(options: AgentRunOptions): Promise<void> {
        const { query, callbacks, agentId, saverId, threadId, scheduler: { schedulerType, schedulerId }, extraInfo, memoryId, agentTools } = options;
        if (!agentId.trim())   throw new Error("agent not specified");
        if (!saverId.trim())   throw new Error("saver not specified");
        if (!threadId.trim())  throw new Error("threadId not specified");

        const cancellationToken = sessionManager.start(threadId);
        try {
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
  <scheduler>
    <scheduler-type>${schedulerType}</scheduler-type>
    <scheduler-id>${schedulerId}</scheduler-id>
  </scheduler>
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
            await AgentRunner.registerMemoryService(container, memoryId);
            await AgentRunner.registerSaverService(container, saverId, threadId);

            const agent = await AgentFactory.create({ agentId, container, extraPrompts, agentTools });
            try {
                await agent.stream(query, callbacks, cancellationToken);
            } finally {
                await agent.dispose();
            }
        } finally {
            sessionManager.end(threadId);
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
        });
        container.registerInstance(T_MemorySystemPromptTemplate, loadPrompt('memory/system.txt'));
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
