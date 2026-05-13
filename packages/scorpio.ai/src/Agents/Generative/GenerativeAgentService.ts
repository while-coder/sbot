import { inject, T_StaticSystemPrompts, T_DynamicSystemPrompts, T_MaxHistoryRounds } from "../../Core";
import { MCPContentType } from "../../Tools/types";
import { IModelService } from "../../Model";
import { IAgentSaverService } from "../../Saver";
import { ILoggerService } from "../../Logger";
import { IMemoryService } from "../../Memory";
import { AgentServiceBase, IAgentCallback, AgentCancelledError, ChatMessage, MessageRole } from "../AgentServiceBase";

import type { MessageContent } from "../../Saver/IAgentSaverService";

export { ChatMessage, MessageRole, IAgentCallback, AgentCancelledError } from "../AgentServiceBase";

const DEFAULT_MAX_HISTORY_ROUNDS = 5;

/**
 * 纯生成式 Agent（图片/音频/视频等）
 * 无工具循环、无 system message 构建、无 memory/wiki 保存，单次模型调用后直接返回。
 * 使用滑动窗口保留最近 N 轮对话，避免二进制数据（图片/音频）撑爆 context window。
 */
export class GenerativeAgentService extends AgentServiceBase {
    protected modelService: IModelService;
    protected staticSystemPrompts: string[];
    protected dynamicSystemPrompts: string[];
    protected maxHistoryRounds: number;

    constructor(
        @inject(IModelService) modelService: IModelService,
        @inject(T_StaticSystemPrompts, { optional: true }) staticSystemPrompts?: string[],
        @inject(T_DynamicSystemPrompts, { optional: true }) dynamicSystemPrompts?: string[],
        @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService,
        @inject(IAgentSaverService, { optional: true }) agentSaver?: IAgentSaverService,
        @inject(IMemoryService, { optional: true }) memoryServices?: IMemoryService[],
        @inject(T_MaxHistoryRounds, { optional: true }) maxHistoryRounds?: number,
    ) {
        super(loggerService, agentSaver, memoryServices);
        this.modelService = modelService;
        this.staticSystemPrompts = staticSystemPrompts ?? [];
        this.dynamicSystemPrompts = dynamicSystemPrompts ?? [];
        this.maxHistoryRounds = maxHistoryRounds ?? DEFAULT_MAX_HISTORY_ROUNDS;
    }

    override addStaticSystemPrompts(prompts: string[]): void {
        this.staticSystemPrompts.unshift(...prompts);
    }

    override addDynamicSystemPrompts(prompts: string[]): void {
        this.dynamicSystemPrompts.push(...prompts);
    }

    override async stream(query: MessageContent, callback: IAgentCallback, signal?: AbortSignal): Promise<ChatMessage[]> {
        await this.saverService.pushMessage({ role: MessageRole.Human, content: query });

        const savedHistory = await this.saverService.getMessages();
        if (!savedHistory || savedHistory.length === 0) {
            throw new Error('historyMessages is empty, cannot call model');
        }

        const history = this.truncateHistory(savedHistory);

        const contentBlocks: Array<{ type: "text"; text: string }> = [];
        const staticContent = this.staticSystemPrompts.join('\n\n').trim();
        if (staticContent) contentBlocks.push({ type: "text", text: staticContent });
        const dynamicContent = this.dynamicSystemPrompts.join('\n\n').trim();
        if (dynamicContent) contentBlocks.push({ type: "text", text: dynamicContent });
        const messages: ChatMessage[] = [
            ...(contentBlocks.length > 0 ? [{ role: MessageRole.System, content: contentBlocks }] : []),
            ...history,
        ];

        if (signal?.aborted) throw new AgentCancelledError();
        const result = await this.modelService.invoke(messages);

        if (result.usage) {
            await callback?.onUsage?.(result.usage);
            delete result.usage;
        }

        GenerativeAgentService.normalizeMessageContent(result);

        await this.saverService.pushMessage(result);
        if (callback.onMessage) await callback.onMessage(result);

        return [result];
    }

    /**
     * 滑动窗口截断：保留最近 maxHistoryRounds 轮对话（1 轮 = 1 human + 1 ai）。
     * 生成式模型的历史消息通常包含大量二进制数据，传统文本摘要无法有效处理。
     */
    protected truncateHistory(messages: ChatMessage[]): ChatMessage[] {
        const maxMessages = this.maxHistoryRounds * 2;
        if (messages.length <= maxMessages) return messages;
        return messages.slice(-maxMessages);
    }

    static normalizeMessageContent(message: ChatMessage): void {
        if (!Array.isArray(message.content)) return;
        message.content = message.content.map(part => {
            if (part.type === 'inlineData' && part.inlineData?.data) {
                const mime: string = part.inlineData.mimeType ?? 'image/png';
                return mime.startsWith('audio/')
                    ? { type: MCPContentType.Audio, data: part.inlineData.data, mimeType: mime }
                    : { type: MCPContentType.Image, data: part.inlineData.data, mimeType: mime };
            }
            if (part.type === 'image_url') {
                const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
                if (url) return { type: MCPContentType.Image, data: url, mimeType: 'image/png' };
            }
            return part;
        });
    }
}
