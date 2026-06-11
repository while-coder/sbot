import { StateGraph, START, END } from '../../Graph';
import { type StructuredToolInterface } from "@langchain/core/tools";
import { inject, T_StaticSystemPrompts, T_DynamicSystemPrompts, T_ModelCallTimeout, T_ToolOverflowDir, truncate } from "../../Core";
import { IModelService } from "../../Model";
import { ISkillService } from "../../Skills";
import { IInsightService } from "../../Insight";
import { IAgendaService, AgendaToolProvider } from "../../Agenda";
import { INoteService, NoteToolProvider } from "../../Note";
import { IWikiService } from "../../Wiki";
import { WikiToolProvider } from "../../Wiki";
import { IAgentSaverService } from "../../Saver";
import { ConversationCompactor, IConversationCompactor, METADATA_KEY_INPUT_TOKENS } from "../../Saver/ConversationCompactor";
import { IAgentToolService } from "../../AgentTool";
import { ILoggerService } from "../../Logger";
import { normalizeToMCPResult, truncateMCPToolResult, MCPContentType } from '../../Tools';
import { AgentServiceBase, GraphNodeType, ToolApproval, IAgentCallback, AgentCancelledError, DEFAULT_MAX_HISTORY_TOKENS, ChatMessage, MessageRole, type TokenUsage } from "../AgentServiceBase";
import { ContentPartType, type MessageContent } from "../../Saver/IAgentSaverService";
import { contentToString, truncateForLog } from "../../Utils/contentUtils";

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
    protected skillService: ISkillService;
    protected insightService?: IInsightService;
    protected agendaService?: IAgendaService;
    protected toolService?: IAgentToolService;
    protected staticSystemPrompts: string[];
    protected dynamicSystemPrompts: string[];
    protected modelCallTimeout?: number;
    protected compactor?: ConversationCompactor;
    protected toolOverflowDir: string;

    constructor(
        @inject(IModelService) modelService: IModelService,
        @inject(ISkillService) skillService: ISkillService,
        @inject(T_ToolOverflowDir) toolOverflowDir: string,
        @inject(T_StaticSystemPrompts, { optional: true }) staticSystemPrompts?: string[],
        @inject(T_DynamicSystemPrompts, { optional: true }) dynamicSystemPrompts?: string[],
        @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService,
        @inject(IAgentSaverService, { optional: true }) agentSaver?: IAgentSaverService,
        @inject(IInsightService, { optional: true }) insightService?: IInsightService,
        @inject(IAgendaService, { optional: true }) agendaService?: IAgendaService,
        @inject(IAgentToolService, { optional: true }) toolService?: IAgentToolService,
        @inject(INoteService, { optional: true }) noteServices?: INoteService[],
        @inject(IWikiService, { optional: true }) wikiServices?: IWikiService[],
        @inject(T_ModelCallTimeout, { optional: true }) modelCallTimeout?: number,
        @inject(IConversationCompactor, { optional: true }) compactor?: ConversationCompactor,
    ) {
        super(loggerService, agentSaver, noteServices, wikiServices);
        this.modelService = modelService;
        this.skillService = skillService;
        this.insightService = insightService;
        this.agendaService = agendaService;
        this.toolService = toolService;
        this.staticSystemPrompts = staticSystemPrompts ?? [];
        this.dynamicSystemPrompts = dynamicSystemPrompts ?? [];
        this.modelCallTimeout = modelCallTimeout;
        this.compactor = compactor;
        this.toolOverflowDir = toolOverflowDir;
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
        const skillMessage = await this.skillService.getSystemMessage();
        if (skillMessage) staticParts.push(skillMessage);

        // ── 动态部分（每次请求可能变化） ──
        const dynamicParts: string[] = [...this.dynamicSystemPrompts];
        const queryText = contentToString(query);

        if (this.insightService) {
            const insightMessage = await this.insightService.getSystemMessage(queryText);
            if (insightMessage) dynamicParts.push(insightMessage);
        }

        if (this.noteServices.length > 0) {
            const noteMessages = await Promise.all(this.noteServices.map(n => n.getSystemMessage(queryText)));
            for (const msg of noteMessages) {
                if (msg) dynamicParts.push(msg);
            }
        }
        if (this.wikiServices.length > 0) {
            const wikiMessages = await Promise.all(this.wikiServices.map(w => w.getSystemMessage(queryText)));
            for (const msg of wikiMessages) {
                if (msg) dynamicParts.push(msg);
            }
        }
        const contentBlocks: Array<{ type: string; text: string }> = [];
        const staticContent = staticParts.join("\n\n").trim();
        if (staticContent) contentBlocks.push({ type: ContentPartType.Text, text: staticContent });
        const dynamicContent = dynamicParts.join("\n\n").trim();
        if (dynamicContent) contentBlocks.push({ type: ContentPartType.Text, text: dynamicContent });
        if (contentBlocks.length === 0) return undefined;
        return { role: MessageRole.System, content: contentBlocks };
    }

    /**
     * 构建本轮所有可用工具（toolService + 笔记 + skill）
     */
    protected async buildTools(_callback?: IAgentCallback, _signal?: AbortSignal): Promise<StructuredToolInterface[]> {
        const tools: StructuredToolInterface[] = await this.toolService?.getAllTools() ?? [];
        if (this.skillService) tools.push(...this.skillService.getTools());
        if (this.noteServices.length > 0) {
            tools.push(...NoteToolProvider.getTools(this.noteServices));
        }
        if (this.wikiServices.length > 0) {
            tools.push(...WikiToolProvider.getTools(this.wikiServices));
        }
        if (this.agendaService) {
            tools.push(...AgendaToolProvider.getTools(this.agendaService));
        }

        // 同名工具会被 OpenAI 兼容端点判为非法请求（400），按首次出现去重
        const unique = new Map<string, StructuredToolInterface>();
        const duplicates = new Set<string>();
        for (const tool of tools) {
            if (unique.has(tool.name)) {
                duplicates.add(tool.name);
            } else {
                unique.set(tool.name, tool);
            }
        }
        if (duplicates.size > 0) {
            this.logger?.warn(`检测到同名工具，已去重保留首个: ${[...duplicates].join(', ')}`);
        }
        const deduped = [...unique.values()];

        // maxTools：部分端点（豆包、Qwen 等）对工具数量有硬上限，超过即 400 无 body
        const maxTools = this.modelService.config.maxTools;
        if (maxTools != null && deduped.length > maxTools) {
            const dropped = deduped.slice(maxTools).map(t => t.name);
            this.logger?.warn(`工具数量 ${deduped.length} 超过模型 maxTools=${maxTools}，已按声明顺序截断，丢弃: ${dropped.join(', ')}`);
            return deduped.slice(0, maxTools);
        }
        return deduped;
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
        const contextWindow = this.modelService.config.contextWindow ?? DEFAULT_MAX_HISTORY_TOKENS;
        if (this.compactor) {
            const allMessages = await this.saverService.getAllMessages();
            const savedTokens = parseInt(await this.saverService.getMetadata(METADATA_KEY_INPUT_TOKENS) ?? '0', 10);
            if (this.compactor.shouldCompact(savedTokens, allMessages, contextWindow)) {
                const postMessage = await this.compactor.compact(allMessages);
                const compactedIds = allMessages.map(m => m.id);
                await this.saverService.applyCompaction(compactedIds, postMessage);
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

        if (state.signal?.aborted) throw new AgentCancelledError();

        const mergedSignal = this.modelCallTimeout != null
            ? AbortSignal.any([state.signal, AbortSignal.timeout(this.modelCallTimeout)].filter(Boolean) as AbortSignal[])
            : state.signal;

        let lastChunk: ChatMessage | undefined;
        const emitStream = async () => {
            if (!callback?.onStreamMessage || !lastChunk) return;
            await callback.onStreamMessage(lastChunk);
        };
        try {
            const stream = await this.modelService.stream(messages, { signal: mergedSignal });
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
        } catch (err: any) {
            if (err instanceof AgentCancelledError) throw err;
            this.logger?.error(`模型调用失败 status=${err?.status ?? '?'} message=${err?.message}\n${SingleAgentService.dumpRequest(messages, state.tools)}`);
            throw err;
        }
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
                this.logger?.info(`开始执行工具 ${tool.name} 参数: ${truncate(JSON.stringify(parsedArgs), 300)}`);
                const result = await raceCancel(tool.invoke(parsedArgs), state.signal);

                // 标准化为 MCP 格式（自动检测和转换各种格式）
                let mcpResult = normalizeToMCPResult(result);

                // 单条 result 过大时纯头部截断 + 溢出落盘，防止 token 一下被打爆。
                // 失败降级为不带路径的截断。
                try {
                    mcpResult = await truncateMCPToolResult(mcpResult, {
                        spillDir: this.toolOverflowDir,
                        toolCallId: toolCall.id ?? `noid-${Date.now()}-${i}`,
                        toolName: tool.name,
                    });
                } catch (err: any) {
                    this.logger?.warn(`工具结果截断失败 ${tool.name}: ${err?.message ?? err}`);
                }

                const resultStr = JSON.stringify(mcpResult);
                this.logger?.info(`执行工具结束 ${tool.name} 结果: ${truncate(resultStr, 300)}`);

                const thinkId = mcpResult._meta?.thinkId;
                const taskId = mcpResult._meta?.taskId;
                // 将 MCP 结果转为 MessageContent：单条纯文本直接用 string，否则转为多模态数组
                // 图片 part 由 resizeImagesInContent 统一缩放（与 stream 入口共用规则）
                const rawContent: MessageContent = !mcpResult.isError && mcpResult.content.length === 1 && mcpResult.content[0].type === MCPContentType.Text
                    ? mcpResult.content[0].text
                    : mcpResult.content.map(item => {
                        if (item.type === MCPContentType.ImageUrl) {
                            const raw = item.url ?? item.image_url!;
                            return { type: ContentPartType.ImageUrl, image_url: { url: typeof raw === 'string' ? raw : raw.url } };
                        }
                        return item;
                    });
                const content = await this.resizeImagesInContent(rawContent);

                const extra: Record<string, unknown> = {};
                if (thinkId) extra.thinkId = thinkId;
                if (taskId) extra.taskId = taskId;
                toolMessages.push({
                    role: MessageRole.Tool,
                    tool_call_id: toolCall.id || "",
                    content,
                    status: mcpResult.isError ? "error" : "success",
                    additional_kwargs: Object.keys(extra).length > 0 ? extra : undefined,
                });
            } catch (error: any) {
                this.logger?.info(`执行工具错误 ${toolCall.name} 错误: ${truncateForLog(error.message)}`);
                toolMessages.push({ role: MessageRole.Tool, tool_call_id: toolCall.id || "", content: `Execute Tool ${toolCall.name} Error: ${truncateForLog(error.message)}`, status: "error" });
            }
        }

        return { messages: toolMessages };
    }

    /** 模型调用 400/500 时把消息序列与工具列表摘要打到日志，便于定位（如同名工具 / 空 content / tool_calls 与 ToolMessage 不配对等） */
    private static dumpRequest(messages: ChatMessage[], tools: StructuredToolInterface[]): string {
        const msgLines = messages.map((m, i) => {
            const role = m.role;
            const contentInfo = typeof m.content === 'string'
                ? `text(${m.content.length})`
                : Array.isArray(m.content)
                    ? `parts[${m.content.length}]:${m.content.map((p: any) => p?.type ?? typeof p).join(',')}`
                    : `empty`;
            const tc = m.tool_calls?.length ? ` tool_calls=[${m.tool_calls.map(c => `${c.name}#${c.id ?? ''}`).join(',')}]` : '';
            const tcid = m.tool_call_id ? ` tool_call_id=${m.tool_call_id}` : '';
            return `  [${i}] ${role} ${contentInfo}${tc}${tcid}`;
        }).join('\n');
        const toolNames = tools.map(t => t.name).join(', ');
        return `messages(${messages.length}):\n${msgLines}\ntools(${tools.length}): ${toolNames}`;
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
        // 将本次用户消息压入历史（图片 part 在入口统一缩放）
        query = await this.resizeImagesInContent(query);
        await this.saverService.pushMessage({ role: MessageRole.Human, content: query });

        const aiResponses: string[] = [];
        const outputMessages: ChatMessage[] = [];

        try {
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

            // 处理流式输出，每条输出消息压入历史
            for await (const update of graphStream) {
                for (const [, nodeOutput] of Object.entries(update)) {
                    const messages: ChatMessage[] = (nodeOutput as any).messages || [];

                    for (const message of messages) {
                        outputMessages.push(message);
                        // 压入历史：从 additional_kwargs 中取出 thinkId / taskId 作为独立参数，不存入消息体
                        const thinkId = message.additional_kwargs?.thinkId as string | undefined;
                        const taskId = message.additional_kwargs?.taskId as string | undefined;
                        if (thinkId) delete message.additional_kwargs!.thinkId;
                        if (taskId) delete message.additional_kwargs!.taskId;
                        const pushOptions = thinkId || taskId ? { thinkId, taskId } : undefined;
                        await this.saverService.pushMessage(message, pushOptions);

                        if (message.role === MessageRole.AI) {
                            const text = contentToString(message.content);
                            if (text) aiResponses.push(text);
                        }

                        if (callback.onMessage) {
                            if (thinkId || taskId) {
                                message.additional_kwargs = { ...message.additional_kwargs };
                                if (thinkId) message.additional_kwargs.thinkId = thinkId;
                                if (taskId) message.additional_kwargs.taskId = taskId;
                            }
                            await callback.onMessage(message);
                            if (message.additional_kwargs) {
                                if (thinkId) delete message.additional_kwargs.thinkId;
                                if (taskId) delete message.additional_kwargs.taskId;
                            }
                        }
                    }
                }
                // tools node 的补偿消息已全部写入 saver，配对完整后再抛出
                if (signal?.aborted) throw new AgentCancelledError();
            }
        } catch (err) {
            await this.recordException(err);
            throw err;
        }
        // 静默并行提取 insight 和 agenda（互不影响）
        const queryText = contentToString(query);
        const aiText = aiResponses.length > 0 ? aiResponses : undefined;
        const extractTasks: Promise<unknown>[] = [];
        if (this.insightService) {
            extractTasks.push(this.insightService.extractFromConversation(queryText, aiText));
        }
        if (this.agendaService) {
            extractTasks.push(this.agendaService.extractFromConversation(queryText, aiText));
        }
        if (extractTasks.length > 0) {
            const results = await Promise.allSettled(extractTasks);
            for (const r of results) {
                if (r.status === 'rejected') {
                    this.logger?.warn(`Background extraction failed: ${(r.reason as Error)?.message}`);
                }
            }
        }

        return outputMessages;
    }
}
