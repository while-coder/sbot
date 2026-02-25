import "reflect-metadata";
import { UserServiceBase } from "winning.ai";
import {
    IAgentSaverService, AgentSqliteSaver, IAgentToolService, AgentToolService,
    IModelService, ModelServiceFactory,
    IMemoryService, IMemoryDatabase, MemoryDatabase, MemoryEvaluator, MemoryCompressor, MemoryExtractor, MemoryService,
    IEmbeddingService, EmbeddingServiceFactory,
    ServiceContainer,
    ISkillService, SkillService,
    IMemoryExtractor,
    IMemoryEvaluator,
    IMemoryCompressor,
    T_UserId,
    T_MaxMemoryAgeDays,
    T_MemoryMode,
    T_SkillsDirs,
    T_DBPath,
    AgentMessage,
    AgentToolCall,
    MCPToolResult,
    ICommand,
} from "scorpio.ai";
import { Response } from "express";
import { LoggerService } from "../LoggerService";
import { getBuiltInCommands } from "../UserService/BuiltInCommands";
import { config } from "../Config";
import { AgentFactory } from "../AgentFactory";

const logger = LoggerService.getLogger('WebUserService.ts');

export type WebChatEvent =
    | { type: "stream"; content: string }
    | { type: "message"; role: string; content?: string; tool_calls?: any[] }
    | { type: "tool_call"; name: string; args: Record<string, any> }
    | { type: "done" }
    | { type: "error"; message: string };

type EmitFn = (event: WebChatEvent) => void;

export class WebUserService extends UserServiceBase {
    static allUsers = new Map<string, WebUserService>();

    static getUser(userId: string): WebUserService {
        if (WebUserService.allUsers.has(userId)) {
            return WebUserService.allUsers.get(userId)!;
        }
        const user = new WebUserService(userId);
        WebUserService.allUsers.set(userId, user);
        return user;
    }

    private currentEmit?: EmitFn;

    private emit(event: WebChatEvent) {
        this.currentEmit?.(event);
    }

    /**
     * 处理 Web 消息，消息按顺序执行，支持 / 开头的命令。
     * - await：等待处理完成（SSE 场景）
     * - 不 await：fire-and-forget
     */
    async onReceiveWebMessage(query: string, emitFn: EmitFn): Promise<void> {
        return new Promise<void>((resolve) => {
            this.onReceiveMessage(query, { emitFn }, resolve);
        });
    }

    // ===== UserServiceBase 抽象方法实现 =====

    protected async getAllCommands(): Promise<ICommand[]> {
        return getBuiltInCommands();
    }

    protected async startProcessMessage(_query: string, args: any): Promise<string> {
        this.currentEmit = (args as { emitFn: EmitFn }).emitFn;
        return '';
    }

    protected async onMessageProcessed(_query: string, _args: any): Promise<void> {
        this.emit({ type: "done" });
        this.currentEmit = undefined;
    }

    protected async processMessageError(e: any): Promise<void> {
        this.emit({ type: "error", message: e.message });
    }

    protected async onAgentMessage(message: AgentMessage): Promise<void> {
        this.emit({
            type: "message",
            role: message.type,
            content: message.content,
            tool_calls: message.tool_calls,
        });
    }

    protected async onAgentStreamMessage(message: AgentMessage): Promise<void> {
        this.emit({ type: "stream", content: message.content ?? "" });
    }

    protected async executeAgentTool(toolCall: AgentToolCall): Promise<boolean> {
        this.emit({ type: "tool_call", name: toolCall.name, args: toolCall.args });
        return true; // Web 模式自动批准所有工具
    }

    // ===== AI 消息处理 =====

    protected async processAIMessage(query: string, _args: any): Promise<void> {
        // 创建 DI 容器并注册服务
        const container = new ServiceContainer();

        // 可选：注册记忆相关依赖（需要 memory.embedding 配置才启用）
        const memoryConfig = config.settings.memory;
        if (memoryConfig?.enabled && memoryConfig?.embedding) {
            const evaluatorModelConfig = memoryConfig.evaluator ? config.getModel(memoryConfig.evaluator) : undefined;
            if (evaluatorModelConfig) {
                container.registerWithArgs(IMemoryEvaluator, MemoryEvaluator, {
                    [IModelService]: await ModelServiceFactory.getModelService(evaluatorModelConfig),
                });
            }
            const extractorModelConfig = memoryConfig.extractor ? config.getModel(memoryConfig.extractor) : undefined;
            if (extractorModelConfig) {
                container.registerWithArgs(IMemoryExtractor, MemoryExtractor, {
                    [IModelService]: await ModelServiceFactory.getModelService(extractorModelConfig),
                });
            }
            const compressorModelConfig = memoryConfig.compressor ? config.getModel(memoryConfig.compressor) : undefined;
            if (compressorModelConfig) {
                container.registerWithArgs(IMemoryCompressor, MemoryCompressor, {
                    [IModelService]: await ModelServiceFactory.getModelService(compressorModelConfig),
                });
            }
            const embeddingConfig = config.getEmbedding(memoryConfig.embedding);
            if (!embeddingConfig) throw new Error(`Embedding 配置 "${memoryConfig.embedding}" 不存在`);
            container.registerWithArgs(IMemoryService, MemoryService, {
                [T_UserId]: this.userId,
                [IEmbeddingService]: await EmbeddingServiceFactory.getEmbeddingService(embeddingConfig),
                [IMemoryDatabase]: new MemoryDatabase(config.getUserMemoryPath(this.userId)),
                [T_MaxMemoryAgeDays]: memoryConfig.maxAgeDays,
                [T_MemoryMode]: memoryConfig.mode,
            });
        }

        container.registerWithArgs(ISkillService, SkillService, {
            [T_SkillsDirs]: [config.getConfigPath("skills")],
        });

        container.registerWithArgs(IAgentSaverService, AgentSqliteSaver, {
            [T_DBPath]: config.getUserSaverPath(this.userId),
        });

        container.registerSingleton(IAgentToolService, AgentToolService);

        const agentToolService = await container.resolve<AgentToolService>(IAgentToolService);
        const mcpServers = config.getMcpServers();
        if (Object.keys(mcpServers).length > 0) await agentToolService.addMcpServers(mcpServers);
        const builtinMcpServers = config.getBuiltinMcpServers();
        if (Object.keys(builtinMcpServers).length > 0) await agentToolService.addMcpServers(builtinMcpServers);

        const agentName = config.settings.agent;
        if (!agentName) throw new Error("未配置 agent，请在 settings.json 中设置 agent 字段");
        const agentEntry = config.settings.agents?.[agentName];
        if (!agentEntry) throw new Error(`Agent 配置 "${agentName}" 不存在，请检查 settings.json 中的 agents 配置`);

        logger.info(`WebUser ${this.userId} 使用 Agent [${agentName}] (${agentEntry.type})`);

        const agent = await AgentFactory.create(container, agentEntry, this.userId);

        await agent.stream(query, {
            onMessage: this.onAgentMessage.bind(this),
            onStreamMessage: this.onAgentStreamMessage.bind(this),
            executeTool: this.executeAgentTool.bind(this),
            convertImages: async (result: MCPToolResult) => result,
        });
    }

    // ===== SSE 辅助 =====

    static sendSSE(res: Response, run: (emit: EmitFn) => Promise<void>): void {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.flushHeaders();

        const write: EmitFn = (event) => {
            res.write(`data: ${JSON.stringify(event)}\n\n`);
        };

        run(write).finally(() => res.end());
    }
}
