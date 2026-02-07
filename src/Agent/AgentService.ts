import { HumanMessage, AIMessage, ToolMessage, BaseMessage, AIMessageChunk } from "langchain";
import { Util } from "weimingcommons";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import {StateGraph, END, START, MessagesAnnotation} from '@langchain/langgraph';
import {SqliteSaver} from "@langchain/langgraph-checkpoint-sqlite";
import {config, ModelConfig} from "../Config";
import {LoggerService} from "../LoggerService";
import { transient, inject } from "../Core";
import { IModelService } from "../Model";
import { Skill, SkillService } from "../Skills";
import { MCPToolResult, normalizeToMCPResult } from '../Tools/ToolsConfig'
import { createFileSystemTools } from '../Tools/FileSystem'
import { createSkillTools } from "../Tools/Skills";
import { createCommandTools } from '../Tools/Command';
import { MemoryService } from "../Memory/MemoryService";


const logger = LoggerService.getLogger("AgentService.ts");

export enum MessageChunkType {
    AI = "ai",
    TOOL = "tool",
    COMMAND = "command",
}

export type AgentToolCall = {
    id?: string;
    name: string;
    args: Record<string, any>;
};

export type AgentMessage = {
    type: MessageChunkType;
    content?: string;
    tool_calls?: AgentToolCall[];
    tool_call_id?: string;
    status?: string;
};

/**
 * 工具调用回调类型 - 用于在工具执行前进行确认
 * @param toolCall 工具调用信息
 * @returns Promise<boolean> - true 表示允许执行，false 表示拒绝执行
 */
export type ExecuteToolCallback = (toolCall: AgentToolCall) => Promise<boolean>;

/**
 * 消息回调类型 - 用于接收完整的消息（在节点输出完成后触发）
 * @param message 消息块
 */
export type OnMessageCallback = (message: AgentMessage) => Promise<void>;

/**
 * 流式消息回调类型 - 用于接收实时的流式消息块（在模型生成过程中触发）
 * @param message 消息块
 */
export type OnStreamMessageCallback = (message: AgentMessage) => Promise<void>;

/**
 * 图片转换回调类型 - 用于转换工具返回内容中的图片链接
 * @param result MCP 标准格式的工具结果
 * @returns Promise<MCPToolResult> - 转换后的 MCP 格式结果
 */
export type ConvertImagesCallback = (result: MCPToolResult) => Promise<MCPToolResult>;

/**
 * 使用 LangGraph 的 StateGraph 构建的 Agent 服务
 * 提供更灵活的工作流控制和状态管理
 */
@transient()
export class AgentService {
    private threadId: string;
    tools: any[] = [];
    disabledAutoApproveTools: Set<string> = new Set<string>();
    saver:SqliteSaver|undefined;
    private modelService?: IModelService;
    private skillService?: SkillService;
    private maxHistoryMessages: number = 10; // 最大历史消息数
    private memoryService?: MemoryService;


    constructor(
        @inject("UserId") userId: string,
        @inject(IModelService, { optional: true }) modelService?: IModelService,
        @inject(SkillService, { optional: true }) skillService?: SkillService,
        @inject(MemoryService, { optional: true }) memoryService?: MemoryService,
    ) {
        this.threadId = userId;
        this.modelService = modelService;
        this.skillService = skillService;
        this.memoryService = memoryService;

        if (this.memoryService) {
            logger.info(`用户 ${userId} 的长期记忆服务已启用`);
        }

        if (this.skillService) {
            const stats = this.skillService.getStatistics();
            logger.info(`用户 ${userId} 的技能服务已启用，加载了 ${stats.totalSkills} 个技能`);
        }
    }

    /**
     * 清除当前线程的所有历史记录
     */
    async clearSaver() {
        const saver = await this.createSaver()
        await saver.deleteThread(this.threadId)
        await this.disposeSaver();
        logger.info(`清除用户 ${this.threadId} 的所有历史记录`)
    }
    /**
     * 释放资源
     */
    async disposeSaver() {
        if (this.saver) {
            try {
                // SqliteSaver 通常会有 end() 或类似方法来关闭数据库连接
                // @ts-ignore - SqliteSaver 可能有 db 属性用于访问底层数据库
                if (this.saver.db && typeof this.saver.db.close === 'function') {
                    await this.saver.db.close();
                }
            } catch (error: any) {
                logger.warn(`用户 ${this.threadId} 释放saver 资源时出错: ${error.message}`);
            } finally {
                this.saver = undefined;
            }
        }
    }
    /**
     * 释放资源
     */
    async dispose() {
        await this.disposeSaver();

        if (this.memoryService) {
            this.memoryService.dispose();
        }
    }

    /**
     * 获取记忆服务实例（供外部使用）
     */
    getMemoryService(): MemoryService | undefined {
        return this.memoryService;
    }

    /**
     * 清空当前用户的所有长期记忆
     */
    async clearMemories(): Promise<number> {
        if (!this.memoryService) {
            logger.warn(`用户 ${this.threadId} 未启用记忆服务`);
            return 0;
        }
        return this.memoryService.clearAllMemories();
    }

    /**
     * 获取记忆统计信息
     */
    getMemoryStatistics() {
        if (!this.memoryService) {
            return null;
        }
        return this.memoryService.getStatistics();
    }

    /**
     * 初始化工具
     */
    private async createTools() {
        if (this.tools.length > 0) return this.tools;

        this.disabledAutoApproveTools = new Set<string>()
        this.tools = []

        // 添加文件系统工具
        const fileSystemTools = createFileSystemTools({ maxFileSize: 10 * 1024 * 1024 });
        this.tools.push(...fileSystemTools);

        // 添加命令执行工具
        const commandTools = createCommandTools();
        this.tools.push(...commandTools);

        // 添加 skill 工具（如果 skillService 可用）
        if (this.skillService) {
            const stats = this.skillService.getStatistics();
            const skillTools = createSkillTools(stats.skillsDir);
            this.tools.push(...skillTools);
        }

        await this.addMcpServers(config.getBuiltinMcpServers())
        // 从 mcp.json 自动加载 MCP 服务器配置
        const mcpServers = config.getMcpServers();
        if (mcpServers) {
            await this.addMcpServers(mcpServers);
        }

        return this.tools;
    }

    /**
     * 添加 MCP 服务器工具
     */
    private async addMcpServers(mcpServers: any) {
        if (Object.keys(mcpServers).length == 0) return

        // 收集所有被禁用的工具名称
        const disabledTools = new Set<string>();

        for (let key in mcpServers) {
            if (mcpServers[key]?.disabledAutoApproveTools != null) {
                mcpServers[key].disabledAutoApproveTools.forEach((tool: string) => {
                    this.disabledAutoApproveTools.add(tool);
                });
            }

            // 收集 disabled 列表中的工具
            if (mcpServers[key]?.disabled != null) {
                mcpServers[key].disabled.forEach((tool: string) => {
                    disabledTools.add(tool);
                });
            }
        }

        const mcpClient = new MultiServerMCPClient({ mcpServers });
        let tools = await mcpClient.getTools()

        for (let tool of tools) {
            // 排除掉 disabled 中包含的工具和已存在的工具
            if (!disabledTools.has(tool.name) && this.tools.findIndex(x => x.name == tool.name) < 0) {
                this.tools.push(tool)
            }
        }
    }
    /**
     * 判断是否应该继续执行
     */
    private agentNext(state: typeof MessagesAnnotation.State): "tools" | typeof END {
        const messages = state.messages;
        const lastMessage = messages[messages.length - 1] as AIMessage;

        // 如果 LLM 调用了工具，则路由到 tools 节点
        if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
            return "tools";
        }
        // 否则结束
        return END;
    }
    /**
     * 调用模型节点
     */
    private async callModelNode(state: typeof MessagesAnnotation.State, onStreamMessage?: OnStreamMessageCallback) {
        if (!this.modelService) {
            throw new Error("模型服务未初始化");
        }
        const tools = await this.createTools();

        // 绑定工具到模型
        this.modelService.bindTools(tools);

        // 获取用户最新消息（用于记忆检索）
        const lastHumanMessage = state.messages
            .slice()
            .reverse()
            .find(m => m instanceof HumanMessage);

        // 构建基础系统提示词
        const systemMessages = [
            { role: "system", content: `你是一个有用的AI助手。` },
        ];

        // 注入长期记忆
        if (this.memoryService && lastHumanMessage) {
            try {
                const memorySummary = await this.memoryService.getMemorySummary(
                    lastHumanMessage.content as string,
                    500 // 最大 token 数
                );

                if (memorySummary) {
                    systemMessages.push({
                        role: "system",
                        content: memorySummary
                    });
                    logger.debug(`已注入长期记忆上下文到提示词中`);
                }
            } catch (error: any) {
                logger.warn(`获取记忆摘要失败: ${error.message}`);
            }
        }

        // 构建 skills 系统提示词
        if (this.skillService) {
            const skillSystemMessage = this.skillService.getSystemMessage();
            if (skillSystemMessage) {
                systemMessages.push({ role: "system", content: skillSystemMessage });
            }
        }

        // 限制历史消息数量，只保留最近的消息
        let historyMessages = state.messages;
        if (historyMessages.length > this.maxHistoryMessages) {
            // 智能截断：确保消息对的完整性
            historyMessages = this.truncateMessages(historyMessages, this.maxHistoryMessages);
        }

        // 所有提示词
        const messages = [
            ...systemMessages,
            ...historyMessages,
        ];

        // 使用流式调用收集完整响应
        const stream = await this.modelService.stream(messages);

        let response:AIMessageChunk|undefined
        // 收集所有流式片段
        for await (const chunk of stream) {
            if (response == undefined) {
                response = chunk
            } else {
                response = response.concat(chunk)
            }
            if (onStreamMessage) {
                // 转换为回调格式
                const messageChunk = this.convertToMessageChunk(response);
                if (messageChunk) {
                    await onStreamMessage(messageChunk!)
                }
            }
        }
        // 返回新的状态，LangGraph 会自动合并消息
        return { messages: [response] };
    }

    /**
     * 工具执行节点 - 替代 ToolNode
     */
    private async callToolsNode(state: typeof MessagesAnnotation.State, executeTool?: ExecuteToolCallback, convertImages?: ConvertImagesCallback) {
        const messages = state.messages;
        const lastMessage = messages[messages.length - 1] as AIMessage;
        
        // 获取工具调用
        const toolCalls = lastMessage.tool_calls || [];
        if (toolCalls.length === 0) {
            return { messages: [] };
        }
        // 获取可用工具
        const tools = await this.createTools();
        const toolMap = new Map(tools.map(t => [t.name, t]));

        // 执行所有工具调用
        const toolMessages: ToolMessage[] = [];
        for (const toolCall of toolCalls) {
            const tool = toolMap.get(toolCall.name);
            if (!tool) {
                // 工具不存在
                toolMessages.push(
                    new ToolMessage({
                        tool_call_id: toolCall.id || "",
                        content: `Error: Tool '${toolCall.name}' not found`,
                        status: "error"
                    })
                );
                continue;
            }
            try {
                let ok = true;
                if (executeTool && this.disabledAutoApproveTools.has(tool.name)) {
                    ok = await executeTool(toolCall);
                }
                if (ok) {
                    // 执行工具
                    logger.info(`用户 ${this.threadId} 执行工具 ${tool.name} 参数: ${JSON.stringify(toolCall.args)}`);
                    const result = await tool.invoke(toolCall.args);

                    // 标准化为 MCP 格式（自动检测和转换各种格式）
                    let mcpResult = normalizeToMCPResult(result);

                    // 如果提供了图片转换回调，转换内容中的图片
                    if (convertImages) {
                        try {
                            mcpResult = await convertImages(mcpResult);
                        } catch (error: any) {
                            logger.error(`用户 ${this.threadId} 图片转换失败: ${error.message}`);
                            // 图片转换失败不影响工具执行结果，保留原始内容
                        }
                    }

                    // 将 MCP 格式序列化为 JSON 字符串
                    const content = JSON.stringify(mcpResult);

                    toolMessages.push(
                        new ToolMessage({
                            tool_call_id: toolCall.id || "",
                            content: content,
                            status: "success"
                        })
                    );
                } else {
                    toolMessages.push(
                        new ToolMessage({
                            tool_call_id: toolCall.id || "",
                            content: "<font color='red'>用户拒绝调用</font>",
                            status: "error"
                        })
                    );
                }
            } catch (error: any) {
                // 工具执行失败
                toolMessages.push(
                    new ToolMessage({
                        tool_call_id: toolCall.id || "",
                        content: `<font color='red'>Error executing tool: ${error.message}</font>`,
                        status: "error"
                    })
                );
            }
        }

        return { messages: toolMessages };
    }

    private async createSaver():Promise<SqliteSaver> {
        if (this.saver != null) return this.saver;
        // 使用 SQLite 数据库作为 checkpoint 存储
        const dbPath = config.getConfigPath(`saver/${this.threadId}.sqlite`);
        // 初始化 SqliteSaver (无需手动调用 setup，会自动初始化)
        this.saver = SqliteSaver.fromConnString(dbPath);
        return this.saver;
    }
    /**
     * 使用 LangGraph 创建 Agent 图
     * @param onStreamMessage 流式消息回调，通过闭包传递给 callModelNode，避免实例属性冲突
     * @param executeTool 工具执行回调，通过闭包传递给 callToolsNode
     * @param convertImages 图片转换回调，通过闭包传递给 callToolsNode
     */
    private async createGraph(onStreamMessage?: OnStreamMessageCallback, executeTool?: ExecuteToolCallback, convertImages?: ConvertImagesCallback) {
        // 初始化工具
        await this.createTools();
        // 创建状态图，使用闭包传递回调
        const workflow = new StateGraph(MessagesAnnotation)
            // 添加节点 - 使用闭包绑定回调
            .addNode("agent", (state) => this.callModelNode(state, onStreamMessage))
            .addNode("tools", (state) => this.callToolsNode(state, executeTool, convertImages))
            // 添加边
            .addEdge(START, "agent")
            .addConditionalEdges("agent", this.agentNext.bind(this))
            .addEdge("tools", "agent");

        // 编译图，使用 SqliteSaver
        const saver = await this.createSaver()
        return workflow.compile({
            checkpointer: saver
        });
    }

    /**
     * 流式处理用户查询
     * @param query 用户查询
     * @param onMessage 消息回调
     * @param onStreamMessage 流式消息回调
     * @param executeTool 工具执行回调
     * @param convertImages 图片转换回调（可选）
     */
    async stream(query: string, onMessage: OnMessageCallback, onStreamMessage?: OnStreamMessageCallback, executeTool?: ExecuteToolCallback, convertImages?: ConvertImagesCallback): Promise<void> {
        try {
            // 添加用户消息到历史
            const humanMessage = new HumanMessage(query);

            // 检查是否需要清理历史记录
            const historyMessages = await this.prepareHistoryForStream();

            // 准备要传递的消息
            // 如果已经清理过历史，使用清理后的消息；否则只传递当前消息
            const inputMessages = historyMessages.length > 0
                ? [...historyMessages, humanMessage]
                : [humanMessage];

            // 为本次调用创建独立的图，通过闭包传递回调
            const graph = await this.createGraph(onStreamMessage, executeTool, convertImages);
            // 流式执行图 - 使用 updates 模式，每次只返回该步骤的更新
            // 使用 userId 作为 thread_id
            const stream = await graph.stream(
                { messages: inputMessages },
                { streamMode: "updates", configurable: { thread_id: this.threadId } }
            );

            // 收集 AI 响应用于保存记忆
            let aiResponse = "";

            // 处理流式输出
            for await (const update of stream) {
                // update 是一个对象，键是节点名称，值是该节点的输出
                // 例如: { agent: { messages: [...] } } 或 { tools: { messages: [...] } }
                for (const [, nodeOutput] of Object.entries(update)) {
                    // 获取该节点输出的消息
                    const messages = (nodeOutput as any).messages || [];

                    // 处理每条新消息
                    for (const message of messages) {
                        // 跳过人类消息
                        if (message instanceof HumanMessage) continue;

                        // 收集 AI 响应
                        if (message instanceof AIMessage || message instanceof AIMessageChunk) {
                            aiResponse += message.content || "";
                        }

                        // 转换为回调格式
                        const messageChunk = this.convertToMessageChunk(message);
                        if (messageChunk) {
                            await onMessage(messageChunk!)
                        }
                    }
                }
            }

            // 保存对话到长期记忆
            if (this.memoryService && aiResponse) {
                try {
                    await this.memoryService.memorizeConversation(query, aiResponse);
                    logger.debug(`对话已保存到长期记忆`);
                } catch (error: any) {
                    logger.warn(`保存对话记忆失败: ${error.message}`);
                }
            }

        } finally {
            // 确保释放资源
            await this.dispose();
        }
    }

    /**
     * 准备历史记录用于 stream
     * 如果历史记录超过限制，返回截断后的历史消息并清理 saver
     * 否则返回空数组（使用 saver 中的历史）
     */
    private async prepareHistoryForStream(): Promise<BaseMessage[]> {
        try {
            const saver = await this.createSaver();

            // 获取当前状态
            const currentState = await saver.get({ configurable: { thread_id: this.threadId } });

            if (currentState?.channel_values) {
                const channelValues = currentState.channel_values as any;

                if (channelValues.messages && Array.isArray(channelValues.messages)) {
                    const allMessages = channelValues.messages;

                    // 如果超过最大限制，需要清理
                    if (allMessages.length > this.maxHistoryMessages) {
                        // 智能截断：确保消息对的完整性
                        const recentMessages = this.truncateMessages(allMessages, this.maxHistoryMessages);

                        // 删除旧的 thread（清理数据库）
                        await saver.deleteThread(this.threadId);

                        logger.info(`用户 ${this.threadId} 历史消息数 ${allMessages.length} 超过限制 ${this.maxHistoryMessages}，开始清理多余的消息...`);

                        // 返回截断后的历史消息，让 graph.stream 重新初始化
                        return recentMessages;
                    }
                }
            }

            // 历史未超限，返回空数组，使用 saver 中的历史
            return [];

        } catch (error: any) {
            logger.warn(`用户 ${this.threadId} 检查历史记录时出错: ${error.message}`);
            return [];
        }
    }

    /**
     * 智能截断消息历史，确保不会破坏 tool_calls 和 ToolMessage 的配对
     * @param messages 原始消息数组
     * @param maxCount 最大保留数量
     * @returns 截断后的消息数组
     */
    private truncateMessages(messages: BaseMessage[], maxCount: number): BaseMessage[] {
        if (messages.length <= maxCount) {
            return messages;
        }

        // 从目标位置开始向前查找合适的截断点
        let startIndex = messages.length - maxCount;

        // 向前搜索，找到一个不会破坏消息对的位置
        for (let i = startIndex; i >= 0 && i < messages.length; i++) {
            const msg = messages[i];

            // 如果这是一个 ToolMessage，需要检查它前面是否有对应的 AI message with tool_calls
            if (msg instanceof ToolMessage) {
                // 继续向后找，直到找到一个非 ToolMessage 的位置
                continue;
            }

            // 如果这是一个 AI message with tool_calls，需要确保后续的 ToolMessage 都被包含
            if ((msg instanceof AIMessage || msg instanceof AIMessageChunk) && msg.tool_calls && msg.tool_calls.length > 0) {
                // 检查后续有多少个 ToolMessage
                let toolMessageCount = 0;
                for (let j = i + 1; j < messages.length; j++) {
                    if (messages[j] instanceof ToolMessage) {
                        toolMessageCount++;
                    } else {
                        break;
                    }
                }

                // 如果从这里开始能包含所有的 tool messages，这是一个好的截断点
                if (i + toolMessageCount < messages.length) {
                    startIndex = i;
                    break;
                }
            } else {
                // 这是一个普通消息（HumanMessage 或没有 tool_calls 的 AIMessage）
                // 这是一个安全的截断点
                startIndex = i;
                break;
            }
        }

        return messages.slice(startIndex);
    }

    /**
     * 将 BaseMessage 转换为 LangChainMessageChunk 格式
     */
    private convertToMessageChunk(message: BaseMessage): AgentMessage | null {
        if (message instanceof AIMessage || message instanceof AIMessageChunk) {
            // 转换工具调用格式
            const toolCalls: AgentToolCall[] = (message.tool_calls || []).map(tc => ({
                id: tc.id || "",
                name: tc.name,
                args: tc.args
            }));
            return {
                type: MessageChunkType.AI,
                content: message.text as string,
                tool_calls: toolCalls
            };
        } else if (message instanceof ToolMessage) {
            return {
                type: MessageChunkType.TOOL,
                tool_call_id: message.tool_call_id || "",
                status: message.status,
                content: (message.content as string).trim()
            };
        } else {
            logger.warn(`用户 ${this.threadId} 未知AI消息类型 : ${message.constructor.name}`);
        }
        return null;
    }
}