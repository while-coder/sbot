import { HumanMessage, AIMessage, ToolMessage, BaseMessage, AIMessageChunk } from "langchain";
import {StateGraph, END, START, MessagesAnnotation} from '@langchain/langgraph';
import {LoggerService} from "../LoggerService";
import { transient, inject } from "../Core";
import { IModelService } from "../Model";
import { ISkillService } from "../Skills";
import { MCPToolResult, normalizeToMCPResult } from '../Tools/ToolsConfig'
import { IMemoryService } from "../Memory";
import { IAgentSaverService } from "../Saver";
import { IAgentToolService } from "../AgentTool";


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
    private agentSaver?: IAgentSaverService;
    private modelService?: IModelService;
    private skillService?: ISkillService;
    private memoryService?: IMemoryService;
    private toolService?: IAgentToolService;


    constructor(
        @inject("UserId") userId: string,
        @inject(IAgentSaverService, { optional: true }) agentSaver?: IAgentSaverService,
        @inject(IModelService, { optional: true }) modelService?: IModelService,
        @inject(ISkillService, { optional: true }) skillService?: ISkillService,
        @inject(IMemoryService, { optional: true }) memoryService?: IMemoryService,
        @inject(IAgentToolService, { optional: true }) toolService?: IAgentToolService,
    ) {
        this.threadId = userId;
        this.agentSaver = agentSaver;
        this.modelService = modelService;
        this.skillService = skillService;
        this.memoryService = memoryService;
        this.toolService = toolService;

        if (this.memoryService) {
            logger.info(`用户 ${userId} 的长期记忆服务已启用`);
        }

        if (this.skillService) {
            logger.info(`用户 ${userId} 的技能服务已启用，加载了 ${this.skillService.getAllSkills().length} 个技能`);
        }
    }
    /**
     * 释放资源
     */
    async dispose() {
        await this.agentSaver?.dispose();
        await this.memoryService?.dispose()
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
        const tools = await this.toolService?.getTools() ?? [];

        // 绑定工具到模型
        this.modelService.bindTools(tools);

        // 构建基础系统提示词
        const systemMessages = [
            { role: "system", content: `你是一个有用的AI助手。` },
        ];

        // 注入长期记忆
        if (this.memoryService) {
            // 获取用户最新消息（用于记忆检索）
            const lastHumanMessage = state.messages.slice().reverse().find(m => m instanceof HumanMessage);
            if (lastHumanMessage) {
                try {
                    const memorySummary = await this.memoryService.getMemorySummary(
                        lastHumanMessage.content as string,
                        500 // 最大 token 数
                    );

                    if (memorySummary) {
                        logger.info(`用户 ${this.threadId} 的记忆摘要已注入 : ${memorySummary}`);
                        systemMessages.push({role: "system",content: memorySummary});
                    }
                } catch (error: any) {
                    logger.warn(`获取记忆摘要失败: ${error.message}`);
                }
            }
        }

        // 构建 skills 系统提示词
        if (this.skillService) {
            const skillSystemMessage = this.skillService.getSystemMessage();
            if (skillSystemMessage) {
                systemMessages.push({ role: "system", content: skillSystemMessage });
            }
        }

        // 所有提示词
        const messages = [
            ...systemMessages,
            ...state.messages,
        ];

        // 使用流式调用收集完整响应
        const stream = await this.modelService.stream(messages);

        let response:AIMessageChunk|undefined
        const emitStream = async () => {
            if (!onStreamMessage || !response) return;
            const messageChunk = this.convertToMessageChunk(response);
            if (messageChunk) {
                await onStreamMessage(messageChunk);
            }
        };
        let lastStreamCallTime = 0;
        // 收集所有流式片段
        for await (const chunk of stream) {
            if (response == undefined) {
                response = chunk
            } else {
                response = response.concat(chunk)
            }
            const now = Date.now();
            if (now - lastStreamCallTime >= 200) {
                lastStreamCallTime = now;
                await emitStream();
            }
        }
        // 流结束后发送最终状态，确保最后的数据不丢失
        await emitStream();
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
        const tools = await this.toolService?.getTools() ?? [];
        const toolMap = new Map(tools.map(t => [t.name, t]));

        // 执行所有工具调用
        const toolMessages: ToolMessage[] = [];
        for (const toolCall of toolCalls) {
            try {
                const tool = toolMap.get(toolCall.name);
                if (!tool) {
                    throw new Error(`工具不存在`);
                }
                let ok = true;
                if (executeTool && this.toolService?.isDisabledAutoApprove(tool.name)) {
                    ok = await executeTool(toolCall);
                }
                if (!ok) {
                    throw new Error(`用户拒绝调用工具`);
                }
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
                    new ToolMessage({tool_call_id: toolCall.id || "", content: content, status: "success" })
                );
            } catch (error: any) {
                // 工具执行失败
                toolMessages.push(
                    new ToolMessage({tool_call_id: toolCall.id || "", content: `Execute Tool ${toolCall.name} Error: ${error.message}`, status: "error" })
                );
            }
        }

        return { messages: toolMessages };
    }

    /**
     * 使用 LangGraph 创建 Agent 图
     */
    private async createGraph(onStreamMessage?: OnStreamMessageCallback, executeTool?: ExecuteToolCallback, convertImages?: ConvertImagesCallback) {
        // 初始化工具
        await this.toolService?.getTools();
        // 创建状态图，使用闭包传递回调
        const workflow = new StateGraph(MessagesAnnotation)
            .addNode("agent", (state) => this.callModelNode(state, onStreamMessage))
            .addNode("tools", (state) => this.callToolsNode(state, executeTool, convertImages))
            .addEdge(START, "agent")
            .addConditionalEdges("agent", this.agentNext.bind(this))
            .addEdge("tools", "agent");

        // 编译图，使用 AgentSaver 提供的 checkpointer
        const checkpointer = await this.agentSaver?.getCheckpointer();
        logger.info(`正在编译图 : ` + checkpointer);
        return workflow.compile({
            checkpointer: checkpointer
        });
    }

    /**
     * 流式处理用户查询
     */
    async stream(query: string, onMessage: OnMessageCallback, onStreamMessage?: OnStreamMessageCallback, executeTool?: ExecuteToolCallback, convertImages?: ConvertImagesCallback): Promise<void> {
        try {
            // 添加用户消息到历史
            const humanMessage = new HumanMessage(query);

            // 检查是否需要清理历史记录
            const historyMessages = await this.agentSaver?.prepareHistory(this.threadId) ?? [];

            // 准备要传递的消息
            // 如果已经清理过历史，使用清理后的消息；否则只传递当前消息
            const inputMessages = historyMessages.length > 0
                ? [...historyMessages, humanMessage]
                : [humanMessage];

            // 为本次调用创建独立的图，通过闭包传递回调
            const graph = await this.createGraph(onStreamMessage, executeTool, convertImages);
            // 流式执行图 - 使用 updates 模式，每次只返回该步骤的更新
            const stream = await graph.stream(
                { messages: inputMessages },
                { streamMode: "updates", configurable: { thread_id: this.threadId } }
            );

            // 收集 AI 响应用于保存记忆
            let aiResponse = "";

            // 处理流式输出
            for await (const update of stream) {
                for (const [, nodeOutput] of Object.entries(update)) {
                    const messages = (nodeOutput as any).messages || [];

                    for (const message of messages) {
                        if (message instanceof HumanMessage) continue;

                        if (message instanceof AIMessage || message instanceof AIMessageChunk) {
                            aiResponse += message.content || "";
                        }

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
     * 将 BaseMessage 转换为 LangChainMessageChunk 格式
     */
    private convertToMessageChunk(message: BaseMessage): AgentMessage | null {
        if (message instanceof AIMessage || message instanceof AIMessageChunk) {
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
