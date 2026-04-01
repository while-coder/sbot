import { StateGraph, START, END } from '../../Graph';
import { type StructuredToolInterface } from "@langchain/core/tools";
import { inject, T_SystemPrompts, T_MemorySystemPromptTemplate, truncate } from "../../Core";
import { IModelService } from "../../Model";
import { ISkillService } from "../../Skills";
import { IMemoryService } from "../../Memory";
import { IAgentSaverService } from "../../Saver";
import { IAgentToolService } from "../../AgentTool";
import { ILoggerService } from "../../Logger";
import { normalizeToMCPResult, MCPContentType, MCPToolResult } from '../../Tools';
import { AgentServiceBase, GraphNodeType, ToolApproval, IAgentCallback, ICancellationToken, AgentCancelledError, MAX_HISTORY_TOKENS, ChatMessage, MessageRole } from "../AgentServiceBase";
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';

export {
    GraphNodeType,
    ToolApproval,
    ChatToolCall,
    ChatMessage,
    MessageRole,
    IAgentCallback,
    ICancellationToken,
    AgentCancelledError,
} from "../AgentServiceBase";

type SingleAgentState = {
    messages: ChatMessage[];
    callback: IAgentCallback | null;
    systemMessage: ChatMessage | null;
    tools: StructuredToolInterface[];
    cancellationToken: ICancellationToken | null;
};

/**
 * 使用 LangGraph 的 StateGraph 构建的 Agent 服务
 * 提供更灵活的工作流控制和状态管理
 */
export class SingleAgentService extends AgentServiceBase {
    protected modelService: IModelService;
    protected skillService?: ISkillService;
    protected toolService?: IAgentToolService;
    protected systemMessages: ChatMessage[];
    protected memorySystemPromptTemplate?: string;

    constructor(
        @inject(IModelService) modelService: IModelService,
        @inject(T_SystemPrompts, { optional: true }) systemPrompts?: string[],
        @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService,
        @inject(IAgentSaverService, { optional: true }) agentSaver?: IAgentSaverService,
        @inject(ISkillService, { optional: true }) skillService?: ISkillService,
        @inject(IAgentToolService, { optional: true }) toolService?: IAgentToolService,
        @inject(IMemoryService, { optional: true }) memoryServices?: IMemoryService[],
        @inject(T_MemorySystemPromptTemplate, { optional: true }) memorySystemPromptTemplate?: string,
    ) {
        super(loggerService, agentSaver, memoryServices);
        this.modelService = modelService;
        this.skillService = skillService;
        this.toolService = toolService;
        this.systemMessages = (systemPrompts ?? []).map(p => ({ role: MessageRole.System, content: p }));
        this.memorySystemPromptTemplate = memorySystemPromptTemplate;
    }

    override addSystemPrompts(prompts: string[]): void {
        this.systemMessages.unshift(...prompts.map(p => ({ role: MessageRole.System, content: p })));
    }

    /**
     * 构建本轮 system message（基础 + 记忆 + skill 合并为单条）
     */
    protected async buildSystemMessage(query: string, _callback?: IAgentCallback, _cancellationToken?: ICancellationToken): Promise<ChatMessage | null> {
        const parts: string[] = this.systemMessages.map(m => m.content as string);
        if (this.memorySystemPromptTemplate) {
            const memoryLimit = 10;
            const allMemories = (await Promise.all(this.memoryServices.map(mem => mem.getMemories(query, memoryLimit))))
                .flat()
                .sort((a, b) => b.decayedScore - a.decayedScore)
                .slice(0, memoryLimit);
            if (allMemories.length > 0) {
                const items = allMemories.map(({ memory: m }) => `  <memory time="${SingleAgentService.formatTimeAgo(m.metadata.timestamp)}">${m.content}</memory>`).join("\n");
                parts.push(this.memorySystemPromptTemplate.replace('{items}', items));
            }
        }
        if (this.skillService) {
            const skillMessage = await this.skillService.getSystemMessage();
            if (skillMessage) parts.push(skillMessage);
        }
        return { role: MessageRole.System, content: parts.join("\n\n") };
    }

    /**
     * 构建本轮所有可用工具（toolService + 记忆 + skill）
     */
    protected async buildTools(_callback?: IAgentCallback, _cancellationToken?: ICancellationToken): Promise<StructuredToolInterface[]> {
        const tools: StructuredToolInterface[] = await this.toolService?.getAllTools() ?? [];
        if (this.skillService) tools.push(...this.skillService.getTools());
        return tools;
    }

    /**
     * 将 MCPToolResult 中的 base64 图片保存为本地临时文件，返回 file:// URL
     */
    async convertImages(result: MCPToolResult): Promise<MCPToolResult> {
        try {
            const converted: MCPToolResult = { content: [], isError: result.isError };
            for (const item of result.content) {
                if (item.type !== MCPContentType.Image && item.type !== MCPContentType.ImageUrl) {
                    converted.content.push(item);
                    continue;
                }
                try {
                    if (item.type === MCPContentType.Image) {
                        const fileUrl = await this.saveBase64ToTmp(item.data, item.mimeType);
                        converted.content.push({ type: MCPContentType.ImageUrl, url: fileUrl });
                    } else {
                        const raw = item.url ?? item.image_url!;
                        const rawStr = typeof raw === 'string' ? raw : raw.url;
                        if (rawStr.startsWith('data:')) {
                            const fileUrl = await this.saveDataUrlToTmp(rawStr);
                            converted.content.push({ type: MCPContentType.ImageUrl, url: fileUrl });
                        } else {
                            converted.content.push(item);
                        }
                    }
                } catch (error: any) {
                    this.logger?.error(`转换图片失败: ${error.message}`);
                    converted.content.push(item);
                }
            }
            return converted;
        } catch (error: any) {
            this.logger?.error(`图片转换过程出错: ${error.message}`);
            return result;
        }
    }

    private async saveBase64ToTmp(base64: string, mimeType: string): Promise<string> {
        const ext = mimeType.split('/')[1]?.split(';')[0] ?? 'png';
        const filename = `img_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
        const filePath = path.join(os.tmpdir(), filename);
        await fs.writeFile(filePath, Buffer.from(base64, 'base64'));
        return pathToFileURL(filePath).href;
    }

    private async saveDataUrlToTmp(dataUrl: string): Promise<string> {
        const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (!match) throw new Error('Invalid data URL format');
        return this.saveBase64ToTmp(match[2], match[1]);
    }

    /**
     * 调用模型节点
     */
    private async callModelNode(state: SingleAgentState) {
        const callback = state.callback ?? undefined;
        this.modelService.bindTools(state.tools);

        // 每次调用都从 saver 重新取（含 token 截断），防止多轮工具调用后 state.messages 超限
        const savedHistory = await this.saverService.getMessages(MAX_HISTORY_TOKENS);
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

        if (state.cancellationToken?.isCancelled) throw new AgentCancelledError();
        const stream = await this.modelService.stream(messages);

        let lastChunk: ChatMessage | undefined;
        const emitStream = async () => {
            if (!callback?.onStreamMessage || !lastChunk) return;
            await callback.onStreamMessage(lastChunk);
        };
        let lastStreamCallTime = 0;
        for await (const chunk of stream) {
            // AIMessage 尚未写入 saver，此处 throw 不会破坏配对
            if (state.cancellationToken?.isCancelled) throw new AgentCancelledError();
            lastChunk = chunk;
            const now = Date.now();
            if (now - lastStreamCallTime >= 200) {
                lastStreamCallTime = now;
                await emitStream();
            }
        }
        // 流结束后发送最终状态，确保最后的数据不丢失
        await emitStream();
        if (!lastChunk) return { messages: [] };
        return { messages: [lastChunk] };
    }

    /**
     * 工具执行节点 - 替代 ToolNode
     */
    private async callToolsNode(state: SingleAgentState) {
        const callback = state.callback ?? undefined;
        const messages = await this.saverService.getMessages(MAX_HISTORY_TOKENS);
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
            if (state.cancellationToken?.isCancelled) {
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
                    const approval = await callback.executeTool(toolCall);
                    if (approval === ToolApproval.Deny) {
                        throw new Error(`Tool call rejected by user`);
                    }
                }
                // 执行工具（LLM 有时会将数组/对象参数 JSON 序列化成字符串，先做一次反解析）
                const parsedArgs = SingleAgentService.parseStringArgs(toolCall.args);
                const result = await tool.invoke(parsedArgs);

                // 标准化为 MCP 格式（自动检测和转换各种格式）
                let mcpResult = normalizeToMCPResult(result);
                const resultStr = JSON.stringify(mcpResult);
                this.logger?.info(
                    `执行工具 ${tool.name}\n  参数: ${truncate(JSON.stringify(parsedArgs), 150)}\n  结果: ${truncate(resultStr, 100)}`
                );

                // 转换内容中的图片（base64 → 本地 tmp 文件）
                try {
                    mcpResult = await this.convertImages(mcpResult);
                } catch (error: any) {
                    this.logger?.error(`图片转换失败: ${error.message}`);
                }

                // 单条纯文本且无错误标志时直接返回文本，省去 JSON 包装节省 token
                // isError=true 时保留 JSON，让 LLM 能感知到错误信号
                const isError = mcpResult.isError;
                mcpResult.isError = undefined;
                const think_id = mcpResult.think_id;
                mcpResult.think_id = undefined;
                const content =
                    !isError && mcpResult.content.length === 1 && mcpResult.content[0].type === MCPContentType.Text
                        ? mcpResult.content[0].text
                        : JSON.stringify(mcpResult);

                toolMessages.push({
                    role: MessageRole.Tool,
                    tool_call_id: toolCall.id || "",
                    content: content,
                    status: isError ? "error" : "success",
                    additional_kwargs: think_id ? { think_id } : undefined,
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
    override async stream(query: string, callback: IAgentCallback, cancellationToken?: ICancellationToken): Promise<ChatMessage[]> {
        // 将本次用户消息压入历史
        await this.saverService.pushMessage({ role: MessageRole.Human, content: query });

        const [systemMessage, tools] = await Promise.all([
            this.buildSystemMessage(query, callback, cancellationToken),
            this.buildTools(callback, cancellationToken),
        ]);

        const graph = new StateGraph<SingleAgentState>()
            .addNode(GraphNodeType.AGENT, this.callModelNode.bind(this))
            .addNode(GraphNodeType.TOOLS, this.callToolsNode.bind(this))
            .addEdge(START, GraphNodeType.AGENT)
            .addConditionalEdges(GraphNodeType.AGENT, this.agentNext.bind(this))
            .addEdge(GraphNodeType.TOOLS, GraphNodeType.AGENT);
        // this.logger?.info(`开始执行 Agent ${query}  system: ${systemMessage?.content}`);
        const graphStream = graph.stream(
            { messages: [], callback, systemMessage, tools, cancellationToken: cancellationToken ?? null },
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
                    // 压入历史：从 additional_kwargs 中取出 think_id 作为独立参数，不存入消息体
                    const thinkId = message.additional_kwargs?.think_id as string | undefined;
                    if (thinkId) delete message.additional_kwargs!.think_id;
                    await this.saverService.pushMessage(message, thinkId ? { thinkId } : undefined);

                    if (message.role === MessageRole.AI) {
                        const content = message.content;
                        if (typeof content === 'string' && content) {
                            aiResponses.push(content);
                        }
                    }

                    if (callback.onMessage) {
                        if (thinkId) message.additional_kwargs = { ...message.additional_kwargs, think_id: thinkId };
                        await callback.onMessage(message);
                        if (thinkId && message.additional_kwargs) delete message.additional_kwargs.think_id;
                    }
                }
            }
            // tools node 的补偿消息已全部写入 saver，配对完整后再抛出
            if (cancellationToken?.isCancelled) throw new AgentCancelledError();
        }

        // 保存对话到长期记忆
        for (const mem of this.memoryServices) {
            try {
                await mem.memorizeConversation(query, aiResponses.length > 0 ? aiResponses : undefined);
            } catch (error: any) {
                this.logger?.warn(`保存对话记忆失败: ${error.message}`);
            }
        }

        return outputMessages;
    }

    private static formatTimeAgo(timestamp: number): string {
        const diff = Date.now() - timestamp;
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);
        if (days > 0) return `${days}d ago`;
        if (hours > 0) return `${hours}h ago`;
        if (minutes > 0) return `${minutes}m ago`;
        return "just now";
    }
}
