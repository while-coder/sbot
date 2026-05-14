import { StateGraph, START, END } from '../../Graph';
import { type StructuredToolInterface } from "@langchain/core/tools";
import { inject, T_StaticSystemPrompts, T_DynamicSystemPrompts, T_MemorySystemPromptTemplate, T_WikiSystemPromptTemplate, T_ModelCallTimeout, truncate, formatTimeAgo } from "../../Core";
import { IModelService } from "../../Model";
import { ISkillService } from "../../Skills";
import { IInsightService } from "../../Insight";
import { IMemoryService, MemoryToolProvider } from "../../Memory";
import { IWikiService } from "../../Wiki";
import { WikiToolProvider } from "../../Wiki";
import { IAgentSaverService } from "../../Saver";
import { ConversationCompactor, IConversationCompactor, METADATA_KEY_INPUT_TOKENS } from "../../Saver/ConversationCompactor";
import { IAgentToolService } from "../../AgentTool";
import { ILoggerService } from "../../Logger";
import { normalizeToMCPResult, MCPContentType, type MCPToolResult } from '../../Tools';
import { AgentServiceBase, GraphNodeType, ToolApproval, IAgentCallback, AgentCancelledError, DEFAULT_MAX_HISTORY_TOKENS, ChatMessage, MessageRole, type TokenUsage } from "../AgentServiceBase";
import type { MessageContent } from "../../Saver/IAgentSaverService";
import { contentToString } from "../../Utils/contentUtils";

export {
    GraphNodeType,
    ToolApproval,
    ChatToolCall,
    ChatMessage,
    MessageRole,
    IAgentCallback,
    AgentCancelledError,
    type TokenUsage,
} from "../AgentServiceBase";

function raceCancel<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(new AgentCancelledError());
    return new Promise<T>((resolve, reject) => {
        const onAbort = () => reject(new AgentCancelledError());
        signal.addEventListener('abort', onAbort, { once: true });
        promise.then(
            v => { signal.removeEventListener('abort', onAbort); resolve(v); },
            e => { signal.removeEventListener('abort', onAbort); reject(e); },
        );
    });
}

type SingleAgentState = {
    messages: ChatMessage[];
    callback?: IAgentCallback;
    systemMessage?: ChatMessage;
    tools: StructuredToolInterface[];
    signal?: AbortSignal;
};

/**
 * 使用 LangGraph 的 StateGraph 构建的 Agent 服务
 * 提供更灵活的工作流控制和状态管理
 */
export class SingleAgentService extends AgentServiceBase {
    protected modelService: IModelService;
    protected skillService?: ISkillService;
    protected insightService?: IInsightService;
    protected toolService?: IAgentToolService;
    protected staticSystemPrompts: string[];
    protected dynamicSystemPrompts: string[];
    protected memorySystemPromptTemplate?: string;
    protected modelCallTimeout?: number;
    protected compactor?: ConversationCompactor;

    constructor(
        @inject(IModelService) modelService: IModelService,
        @inject(T_StaticSystemPrompts, { optional: true }) staticSystemPrompts?: string[],
        @inject(T_DynamicSystemPrompts, { optional: true }) dynamicSystemPrompts?: string[],
        @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService,
        @inject(IAgentSaverService, { optional: true }) agentSaver?: IAgentSaverService,
        @inject(ISkillService, { optional: true }) skillService?: ISkillService,
        @inject(IInsightService, { optional: true }) insightService?: IInsightService,
        @inject(IAgentToolService, { optional: true }) toolService?: IAgentToolService,
        @inject(IMemoryService, { optional: true }) memoryServices?: IMemoryService[],
        @inject(IWikiService, { optional: true }) protected wikiServices?: IWikiService[],
        @inject(T_MemorySystemPromptTemplate, { optional: true }) memorySystemPromptTemplate?: string,
        @inject(T_WikiSystemPromptTemplate, { optional: true }) protected wikiSystemPromptTemplate?: string,
        @inject(T_ModelCallTimeout, { optional: true }) modelCallTimeout?: number,
        @inject(IConversationCompactor, { optional: true }) compactor?: ConversationCompactor,
    ) {
        super(loggerService, agentSaver, memoryServices);
        this.modelService = modelService;
        this.skillService = skillService;
        this.insightService = insightService;
        this.toolService = toolService;
        this.staticSystemPrompts = staticSystemPrompts ?? [];
        this.dynamicSystemPrompts = dynamicSystemPrompts ?? [];
        this.memorySystemPromptTemplate = memorySystemPromptTemplate;
        this.modelCallTimeout = modelCallTimeout;
        this.compactor = compactor;
    }

    override addStaticSystemPrompts(prompts: string[]): void {
        this.staticSystemPrompts.unshift(...prompts);
    }

    override addDynamicSystemPrompts(prompts: string[]): void {
        this.dynamicSystemPrompts.push(...prompts);
    }

    protected async buildSystemMessage(query: MessageContent): Promise<ChatMessage | undefined> {
        // ── 静态部分（跨请求不变，可被 prompt caching 缓存） ──
        const staticParts: string[] = [...this.staticSystemPrompts];
        if (this.skillService) {
            const skillMessage = await this.skillService.getSystemMessage();
            if (skillMessage) staticParts.push(skillMessage);
        }

        // ── 动态部分（每次请求可能变化） ──
        const dynamicParts: string[] = [...this.dynamicSystemPrompts];
        const queryText = contentToString(query);

        if (this.memorySystemPromptTemplate) {
            const memoryLimit = 10;
            const allMemories = (await Promise.all(this.memoryServices.map(mem => mem.getMemories(queryText, memoryLimit))))
                .flat()
                .sort((a, b) => b.decayedScore - a.decayedScore)
                .slice(0, memoryLimit);
            if (allMemories.length > 0) {
                const items = allMemories.map(({ memory: m }) => `  <memory time="${formatTimeAgo(m.metadata.timestamp)}">${m.content}</memory>`).join("\n");
                dynamicParts.push(this.memorySystemPromptTemplate.replace('{items}', items));
            }
        }
        if (this.insightService) {
            const insightMessage = await this.insightService.getRelevantInsights(queryText);
            if (insightMessage) dynamicParts.push(insightMessage);
        }
        if (this.wikiSystemPromptTemplate && this.wikiServices?.length) {
            const wikiLimit = 5;
            const results = (await Promise.all(
                this.wikiServices.map(w => w.search(queryText, wikiLimit))
            )).flat().slice(0, wikiLimit);
            if (results.length > 0) {
                const items = results.map(r =>
                    `  <wiki id="${r.page.id}" title="${r.page.title}" tags="${r.page.tags.join(', ')}">\n${r.page.content}\n  </wiki>`
                ).join("\n");
                dynamicParts.push(this.wikiSystemPromptTemplate.replace('{items}', items));
            }
        }
        const contentBlocks: Array<{ type: string; text: string }> = [];
        const staticContent = staticParts.join("\n\n").trim();
        if (staticContent) contentBlocks.push({ type: "text", text: staticContent });
        const dynamicContent = dynamicParts.join("\n\n").trim();
        if (dynamicContent) contentBlocks.push({ type: "text", text: dynamicContent });
        if (contentBlocks.length === 0) return undefined;
        return { role: MessageRole.System, content: contentBlocks };
    }

    /**
     * 构建本轮所有可用工具（toolService + 记忆 + skill）
     */
    protected async buildTools(_callback?: IAgentCallback, _signal?: AbortSignal): Promise<StructuredToolInterface[]> {
        const tools: StructuredToolInterface[] = await this.toolService?.getAllTools() ?? [];
        if (this.skillService) tools.push(...this.skillService.getTools());
        if (this.insightService) tools.push(...this.insightService.getTools());
        if (this.memoryServices.length > 0) {
            tools.push(...MemoryToolProvider.getTools(this.memoryServices));
        }
        if (this.wikiServices && this.wikiServices.length > 0) {
            tools.push(...WikiToolProvider.getTools(this.wikiServices));
        }
        return tools;
    }

    /**
     * 调用模型节点
     */
    private async callModelNode(state: SingleAgentState) {
        const callback = state.callback;
        if (state.tools.length > 0) {
            this.modelService.bindTools(state.tools);
        }

        // 自动 compact：input_tokens 超过阈值时压缩早期消息
        const contextWindow = this.modelService.contextWindow ?? DEFAULT_MAX_HISTORY_TOKENS;
        if (this.compactor) {
            const allMessages = await this.saverService.getAllMessages();
            const savedTokens = parseInt(await this.saverService.getMetadata(METADATA_KEY_INPUT_TOKENS) ?? '0', 10);
            if (this.compactor.shouldCompact(savedTokens, allMessages, contextWindow)) {
                const result = await this.compactor.compact(allMessages);
                const compactedIds = allMessages.filter(m => m.id != null).map(m => m.id!);
                await this.saverService.applyCompaction(compactedIds, ConversationCompactor.buildPostCompactMessage(result.summary));
            }
        }

        const savedHistory = await this.saverService.getMessages();
        if (!savedHistory || savedHistory.length === 0) {
            throw new Error('historyMessages is empty, cannot call model');
        }
        const messages: ChatMessage[] = [
            ...(state.systemMessage ? [state.systemMessage] : []),
            ...savedHistory,
        ];

        // this.logger?.debug(`tools count : ${state.tools.length} messages:${messages.length} historyMessages:${historyMessages.length}`)
        // for (const msg of messages) {
        //     const role = msg.constructor.name;
        //     const contentStr = (typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)).replace(/\r?\n/g, ' ');
        //     this.logger?.debug(`  [${role}] ${contentStr.length > 100 ? contentStr.slice(0, 100) + '…' : contentStr}`);
        // }

        if (state.signal?.aborted) throw new AgentCancelledError();

        const mergedSignal = this.modelCallTimeout != null
            ? AbortSignal.any([state.signal, AbortSignal.timeout(this.modelCallTimeout)].filter(Boolean) as AbortSignal[])
            : state.signal;

        let lastChunk: ChatMessage | undefined;
        const stream = await this.modelService.stream(messages, { signal: mergedSignal });

        const emitStream = async () => {
            if (!callback?.onStreamMessage || !lastChunk) return;
            await callback.onStreamMessage(lastChunk);
        };
        let lastStreamCallTime = 0;
        for await (const chunk of stream) {
            if (mergedSignal?.aborted) throw new AgentCancelledError();
            lastChunk = chunk;
            const now = Date.now();
            if (now - lastStreamCallTime >= 200) {
                lastStreamCallTime = now;
                await emitStream();
            }
        }
        await emitStream();
        if (!lastChunk) return { messages: [] };

        if (lastChunk.usage) {
            if (this.compactor) {
                await this.saverService.setMetadata(METADATA_KEY_INPUT_TOKENS, String(lastChunk.usage.input_tokens));
            }
            await callback?.onUsage?.(lastChunk.usage);
            delete lastChunk.usage;
        }

        return { messages: [lastChunk] };
    }

    /**
     * 工具执行节点 - 替代 ToolNode
     */
    private async callToolsNode(state: SingleAgentState) {
        const callback = state.callback;
        const messages = await this.saverService.getMessages();
        if (!messages || messages.length === 0) {
            throw new Error('historyMessages is empty, cannot execute tools');
        }
        const lastMessage = messages[messages.length - 1];

        // 获取工具调用
        const toolCalls = lastMessage.tool_calls || [];
        if (toolCalls.length === 0) {
            return { messages: [] };
        }
        const toolMap = new Map(state.tools.map(t => [t.name, t]));

        // 执行所有工具调用
        const toolMessages: ChatMessage[] = [];
        for (let i = 0; i < toolCalls.length; i++) {
            const toolCall = toolCalls[i];
            // 取消时补偿剩余 tool_calls 的 ToolMessage，保持与 AIMessage 的配对完整
            if (state.signal?.aborted) {
                for (let j = i; j < toolCalls.length; j++) {
                    toolMessages.push({ role: MessageRole.Tool, tool_call_id: toolCalls[j].id ?? "", content: "Cancelled", status: "error" });
                }
                break;
            }
            try {
                const tool = toolMap.get(toolCall.name);
                if (!tool) {
                    throw new Error(`Tool not found`);
                }
                if (callback?.executeTool) {
                    const approval = await raceCancel(callback.executeTool(toolCall), state.signal);
                    if (approval === ToolApproval.Deny) {
                        throw new Error(`Tool call rejected by user`);
                    }
                }
                // 执行工具（LLM 有时会将数组/对象参数 JSON 序列化成字符串，先做一次反解析）
                const parsedArgs = SingleAgentService.parseStringArgs(toolCall.args);
                const result = await raceCancel(tool.invoke(parsedArgs), state.signal);

                // 标准化为 MCP 格式（自动检测和转换各种格式）
                let mcpResult = normalizeToMCPResult(result);
                const resultStr = JSON.stringify(mcpResult);
                this.logger?.info(
                    `执行工具 ${tool.name}\n  参数: ${truncate(JSON.stringify(parsedArgs), 200)}\n  结果: ${truncate(resultStr, 200)}`
                );

                const thinkId = mcpResult.thinkId;
                // 将 MCP 结果转为 MessageContent：单条纯文本直接用 string，否则转为多模态数组
                const content: MessageContent = !mcpResult.isError && mcpResult.content.length === 1 && mcpResult.content[0].type === MCPContentType.Text
                    ? mcpResult.content[0].text
                    : mcpResult.content.map(item => {
                        if (item.type === MCPContentType.Image) {
                            return { type: 'image_url', image_url: { url: `data:${item.mimeType};base64,${item.data}` } };
                        }
                        if (item.type === MCPContentType.ImageUrl) {
                            const raw = item.url ?? item.image_url!;
                            return { type: 'image_url', image_url: { url: typeof raw === 'string' ? raw : raw.url } };
                        }
                        return item;
                    });

                toolMessages.push({
                    role: MessageRole.Tool,
                    tool_call_id: toolCall.id || "",
                    content,
                    status: mcpResult.isError ? "error" : "success",
                    additional_kwargs: thinkId ? { thinkId } : undefined,
                });
            } catch (error: any) {
                toolMessages.push({ role: MessageRole.Tool, tool_call_id: toolCall.id || "", content: `Execute Tool ${toolCall.name} Error: ${error.message}`, status: "error" });
            }
        }

        return { messages: toolMessages };
    }

    /** LLM 有时将数组/对象参数 JSON 序列化成字符串，此函数将顶层字符串值中的 JSON 反解析回来 */
    private static parseStringArgs(args: Record<string, any>): Record<string, any> {
        const result: Record<string, any> = {};
        for (const [k, v] of Object.entries(args)) {
            if (typeof v === 'string' && (v.startsWith('[') || v.startsWith('{'))) {
                try { result[k] = JSON.parse(v); continue; } catch {}
            }
            result[k] = v;
        }
        return result;
    }

    private agentNext(state: { messages: ChatMessage[] }): GraphNodeType.TOOLS | typeof END {
        const lastMessage = state.messages[state.messages.length - 1];
        return lastMessage?.tool_calls?.length ? GraphNodeType.TOOLS : END;
    }

    /**
     * 流式处理用户查询
     */
    override async stream(query: MessageContent, callback: IAgentCallback, signal?: AbortSignal): Promise<ChatMessage[]> {
        // 将本次用户消息压入历史
        await this.saverService.pushMessage({ role: MessageRole.Human, content: query });

        const [systemMessage, tools] = await Promise.all([
            this.buildSystemMessage(query),
            this.buildTools(callback, signal),
        ]);

        const graph = new StateGraph<SingleAgentState>()
            .addNode(GraphNodeType.AGENT, this.callModelNode.bind(this))
            .addNode(GraphNodeType.TOOLS, this.callToolsNode.bind(this))
            .addEdge(START, GraphNodeType.AGENT)
            .addConditionalEdges(GraphNodeType.AGENT, this.agentNext.bind(this))
            .addEdge(GraphNodeType.TOOLS, GraphNodeType.AGENT);
        // this.logger?.info(`开始执行 Agent ${query}  system: ${systemMessage?.content}`);
        const graphStream = graph.stream(
            { messages: [], callback, systemMessage, tools, signal },
        );

        // 收集 AI 响应（供记忆服务按 MemoryMode 决定是否使用）
        const aiResponses: string[] = [];
        const outputMessages: ChatMessage[] = [];

        // 处理流式输出，每条输出消息压入历史
        for await (const update of graphStream) {
            for (const [, nodeOutput] of Object.entries(update)) {
                const messages: ChatMessage[] = (nodeOutput as any).messages || [];

                for (const message of messages) {
                    outputMessages.push(message);
                    // 压入历史：从 additional_kwargs 中取出 thinkId 作为独立参数，不存入消息体
                    const thinkId = message.additional_kwargs?.thinkId as string | undefined;
                    if (thinkId) delete message.additional_kwargs!.thinkId;
                    await this.saverService.pushMessage(message, thinkId ? { thinkId } : undefined);

                    if (message.role === MessageRole.AI) {
                        const content = message.content;
                        if (typeof content === 'string' && content) {
                            aiResponses.push(content);
                        }
                    }

                    if (callback.onMessage) {
                        if (thinkId) message.additional_kwargs = { ...message.additional_kwargs, thinkId };
                        await callback.onMessage(message);
                        if (thinkId && message.additional_kwargs) delete message.additional_kwargs.thinkId;
                    }
                }
            }
            // tools node 的补偿消息已全部写入 saver，配对完整后再抛出
            if (signal?.aborted) throw new AgentCancelledError();
        }

        // 保存对话到长期记忆
        for (const mem of this.memoryServices) {
            try {
                await mem.memorizeConversation(contentToString(query), aiResponses.length > 0 ? aiResponses : undefined);
            } catch (error: any) {
                this.logger?.warn(`保存对话记忆失败: ${error.message}`);
            }
        }

        // 保存对话到 wiki 知识库
        if (this.wikiServices) {
            for (const wiki of this.wikiServices) {
                try {
                    await wiki.extractFromConversation(
                        contentToString(query),
                        aiResponses.length > 0 ? aiResponses : undefined
                    );
                } catch (error: any) {
                    this.logger?.warn(`Wiki knowledge extraction failed: ${error.message}`);
                }
            }
        }

        // 静默提取 insight
        if (this.insightService) {
            try {
                await this.insightService.extractFromConversation(
                    contentToString(query),
                    aiResponses.length > 0 ? aiResponses : undefined
                );
            } catch (error: any) {
                this.logger?.warn(`Insight extraction failed: ${error.message}`);
            }
        }

        return outputMessages;
    }
}
