import { HumanMessage, AIMessage, ToolMessage, AIMessageChunk, BaseMessage, SystemMessage } from "langchain";
import { StateGraph, START, END } from '../../Graph';
import { type StructuredToolInterface } from "@langchain/core/tools";
import { inject, T_SystemPrompts } from "../../Core";
import { IModelService } from "../../Model";
import { ISkillService } from "../../Skills";
import { IMemoryService } from "../../Memory";
import { IAgentSaverService } from "../../Saver";
import { IAgentToolService } from "../../AgentTool";
import { ILoggerService } from "../../Logger";
import { normalizeToMCPResult } from '../../Tools';
import { AgentServiceBase, GraphNodeType, IAgentCallback, MAX_HISTORY_TOKENS } from "../AgentServiceBase";

export {
    MessageChunkType,
    GraphNodeType,
    AgentToolCall,
    AgentMessage,
    IAgentCallback,
} from "../AgentServiceBase";

type SingleAgentState = {
    messages: BaseMessage[];
    callback: IAgentCallback | null;
    systemMessage: SystemMessage | null;
    tools: StructuredToolInterface[];
};

/**
 * 使用 LangGraph 的 StateGraph 构建的 Agent 服务
 * 提供更灵活的工作流控制和状态管理
 */
export class SingleAgentService extends AgentServiceBase {
    protected modelService: IModelService;
    protected skillService?: ISkillService;
    protected toolService?: IAgentToolService;
    protected systemMessages: SystemMessage[];

    constructor(
        @inject(IModelService) modelService: IModelService,
        @inject(T_SystemPrompts, { optional: true }) systemPrompts?: string[],
        @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService,
        @inject(IAgentSaverService, { optional: true }) agentSaver?: IAgentSaverService,
        @inject(ISkillService, { optional: true }) skillService?: ISkillService,
        @inject(IMemoryService, { optional: true }) memoryService?: IMemoryService,
        @inject(IAgentToolService, { optional: true }) toolService?: IAgentToolService,
    ) {
        super(loggerService, agentSaver, memoryService);
        this.modelService = modelService;
        this.skillService = skillService;
        this.toolService = toolService;
        this.systemMessages = (systemPrompts ?? []).map(p => new SystemMessage(p));
    }

    override addSystemPrompts(prompts: string[]): void {
        this.systemMessages.unshift(...prompts.map(p => new SystemMessage(p)));
    }

    /**
     * 构建本轮 system message（基础 + 记忆 + skill 合并为单条）
     */
    private async buildSystemMessage(query: string): Promise<SystemMessage | null> {
        const parts: string[] = this.systemMessages.map(m => m.content as string);
        if (this.memoryService) {
            const memoryMessage = await this.memoryService.getSystemMessage(query, 10);
            if (memoryMessage) parts.push(memoryMessage);
        }
        if (this.skillService) {
            const skillMessage = await this.skillService.getSystemMessage();
            if (skillMessage) parts.push(skillMessage);
        }
        return parts.length > 0 ? new SystemMessage(parts.join("\n\n")) : null;
    }

    /**
     * 构建本轮所有可用工具（toolService + 记忆 + skill）
     */
    private async buildTools(): Promise<StructuredToolInterface[]> {
        const tools: StructuredToolInterface[] = await this.toolService?.getAllTools() ?? [];
        if (this.skillService) tools.push(...this.skillService.getTools());
        return tools;
    }

    /**
     * 调用模型节点
     */
    private async callModelNode(state: SingleAgentState) {
        const callback = state.callback ?? undefined;
        const model = this.modelService.bindTools(state.tools);

        // 每次调用都从 saver 重新取（含 token 截断），防止多轮工具调用后 state.messages 超限
        const historyMessages = await this.saverService.getMessages(MAX_HISTORY_TOKENS);
        const messages = [
            ...(state.systemMessage ? [state.systemMessage] : []),
            ...(historyMessages ?? state.messages),
        ];

        // 使用流式调用收集完整响应
        const stream = await model.stream(messages);

        let accumulated: AIMessageChunk | undefined;
        const emitStream = async () => {
            if (!callback?.onStreamMessage || !accumulated) return;
            const messageChunk = this.convertToMessageChunk(accumulated);
            if (messageChunk) {
                await callback.onStreamMessage(messageChunk);
            }
        };
        let lastStreamCallTime = 0;
        // 收集所有流式片段
        for await (const chunk of stream) {
            accumulated = accumulated ? accumulated.concat(chunk) : chunk;
            const now = Date.now();
            if (now - lastStreamCallTime >= 200) {
                lastStreamCallTime = now;
                await emitStream();
            }
        }
        // 流结束后发送最终状态，确保最后的数据不丢失
        await emitStream();
        if (!accumulated) return { messages: [] };
        const response = new AIMessage({
            content: accumulated.content,
            tool_calls: accumulated.tool_calls,
            id: accumulated.id,
            response_metadata: accumulated.response_metadata,
        });
        return { messages: [response] };
    }

    /**
     * 工具执行节点 - 替代 ToolNode
     */
    private async callToolsNode(state: SingleAgentState) {
        const callback = state.callback ?? undefined;
        const messages = state.messages;
        const lastMessage = messages[messages.length - 1] as AIMessage;

        // 获取工具调用
        const toolCalls = lastMessage.tool_calls || [];
        if (toolCalls.length === 0) {
            return { messages: [] };
        }
        const toolMap = new Map(state.tools.map(t => [t.name, t]));

        // 执行所有工具调用
        const toolMessages: ToolMessage[] = [];
        for (const toolCall of toolCalls) {
            try {
                const tool = toolMap.get(toolCall.name);
                if (!tool) {
                    throw new Error(`工具不存在`);
                }
                let ok = true;
                if (callback?.executeTool && this.toolService?.isDisabledAutoApprove(tool.name)) {
                    ok = await callback.executeTool(toolCall);
                }
                if (!ok) {
                    throw new Error(`用户拒绝调用工具`);
                }
                // 执行工具
                this.logger?.info(`执行工具 ${tool.name} 参数: ${JSON.stringify(toolCall.args)}`);
                const result = await tool.invoke(toolCall.args);

                // 标准化为 MCP 格式（自动检测和转换各种格式）
                let mcpResult = normalizeToMCPResult(result);

                // 如果提供了图片转换回调，转换内容中的图片
                if (callback?.convertImages) {
                    try {
                        mcpResult = await callback.convertImages(mcpResult);
                    } catch (error: any) {
                        this.logger?.error(`图片转换失败: ${error.message}`);
                    }
                }

                // 将 MCP 格式序列化为 JSON 字符串
                const content = JSON.stringify(mcpResult);

                toolMessages.push(
                    new ToolMessage({ tool_call_id: toolCall.id || "", content: content, status: "success" })
                );
            } catch (error: any) {
                toolMessages.push(
                    new ToolMessage({ tool_call_id: toolCall.id || "", content: `Execute Tool ${toolCall.name} Error: ${error.message}`, status: "error" })
                );
            }
        }

        return { messages: toolMessages };
    }

    private agentNext(state: { messages: BaseMessage[] }): GraphNodeType.TOOLS | typeof END {
        const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
        return lastMessage.tool_calls?.length ? GraphNodeType.TOOLS : END;
    }

    /**
     * 流式处理用户查询
     */
    async stream(query: string, callback: IAgentCallback): Promise<BaseMessage[]> {
        const humanMessage = new HumanMessage(query);

        // 将本次用户消息压入历史
        await this.saverService.pushMessage(humanMessage);

        const [historyMessages, systemMessage, tools] = await Promise.all([
            this.saverService.getMessages(MAX_HISTORY_TOKENS),
            this.buildSystemMessage(query),
            this.buildTools(),
        ]);

        const graph = new StateGraph<SingleAgentState>()
            .addNode(GraphNodeType.AGENT, this.callModelNode.bind(this))
            .addNode(GraphNodeType.TOOLS, this.callToolsNode.bind(this))
            .addEdge(START, GraphNodeType.AGENT)
            .addConditionalEdges(GraphNodeType.AGENT, this.agentNext.bind(this))
            .addEdge(GraphNodeType.TOOLS, GraphNodeType.AGENT);

        const graphStream = graph.stream(
            { messages: historyMessages ?? [humanMessage], callback, systemMessage, tools },
        );

        // 收集 AI 响应（供记忆服务按 MemoryMode 决定是否使用）
        const aiResponses: string[] = [];
        const outputMessages: BaseMessage[] = [];

        // 处理流式输出，每条输出消息压入历史
        for await (const update of graphStream) {
            for (const [, nodeOutput] of Object.entries(update)) {
                const messages = (nodeOutput as any).messages || [];

                for (const message of messages) {
                    if (message instanceof HumanMessage) continue;

                    outputMessages.push(message);
                    // 压入历史
                    await this.saverService.pushMessage(message);

                    if (message instanceof AIMessage) {
                        const content = message.content as string;
                        if (content) {
                            aiResponses.push(content);
                        }
                    }

                    const messageChunk = this.convertToMessageChunk(message);
                    if (messageChunk && callback.onMessage) {
                        await callback.onMessage(messageChunk!);
                    }
                }
            }
        }

        // 保存对话到长期记忆
        if (this.memoryService) {
            try {
                await this.memoryService.memorizeConversation(query, aiResponses.length > 0 ? aiResponses : undefined);
            } catch (error: any) {
                this.logger?.warn(`保存对话记忆失败: ${error.message}`);
            }
        }

        return outputMessages;
    }
}
