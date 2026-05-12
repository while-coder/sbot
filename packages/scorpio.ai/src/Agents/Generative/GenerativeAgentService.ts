import { inject, T_StaticSystemPrompts, T_DynamicSystemPrompts } from "../../Core";
import { MCPContentType } from "../../Tools/types";
import { IModelService } from "../../Model";
import { IAgentSaverService } from "../../Saver";
import { ILoggerService } from "../../Logger";
import { IMemoryService } from "../../Memory";
import { AgentServiceBase, IAgentCallback, AgentCancelledError, DEFAULT_MAX_HISTORY_TOKENS, ChatMessage, MessageRole } from "../AgentServiceBase";

import type { MessageContent } from "../../Saver/IAgentSaverService";

export { ChatMessage, MessageRole, IAgentCallback, AgentCancelledError } from "../AgentServiceBase";

/**
 * 纯生成式 Agent（图片/音频/视频等）
 * 无工具循环、无 system message 构建、无 memory/wiki 保存，单次模型调用后直接返回。
 */
export class GenerativeAgentService extends AgentServiceBase {
    protected modelService: IModelService;
    protected systemMessages: ChatMessage[];
    protected dynamicSystemPrompts: string[];

    constructor(
        @inject(IModelService) modelService: IModelService,
        @inject(T_StaticSystemPrompts, { optional: true }) systemPrompts?: string[],
        @inject(T_DynamicSystemPrompts, { optional: true }) dynamicSystemPrompts?: string[],
        @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService,
        @inject(IAgentSaverService, { optional: true }) agentSaver?: IAgentSaverService,
        @inject(IMemoryService, { optional: true }) memoryServices?: IMemoryService[],
    ) {
        super(loggerService, agentSaver, memoryServices);
        this.modelService = modelService;
        this.systemMessages = (systemPrompts ?? []).map(p => ({ role: MessageRole.System, content: p }));
        this.dynamicSystemPrompts = dynamicSystemPrompts ?? [];
    }

    override addSystemPrompts(prompts: string[]): void {
        this.systemMessages.unshift(...prompts.map(p => ({ role: MessageRole.System, content: p })));
    }

    override async stream(query: MessageContent, callback: IAgentCallback, signal?: AbortSignal): Promise<ChatMessage[]> {
        await this.saverService.pushMessage({ role: MessageRole.Human, content: query });

        const savedHistory = await this.saverService.getMessages(this.modelService.contextWindow ?? DEFAULT_MAX_HISTORY_TOKENS);
        if (!savedHistory || savedHistory.length === 0) {
            throw new Error('historyMessages is empty, cannot call model');
        }
        const staticContent = this.systemMessages.map(m => m.content as string).join('\n\n').trim();
        const dynamicContent = this.dynamicSystemPrompts.join('\n\n').trim();
        let systemMsg: ChatMessage | undefined;
        if (staticContent || dynamicContent) {
            const contentBlocks: Array<{ type: string; text: string }> = [];
            if (staticContent) contentBlocks.push({ type: "text", text: staticContent });
            if (dynamicContent) contentBlocks.push({ type: "text", text: dynamicContent });
            systemMsg = { role: MessageRole.System, content: contentBlocks };
        }
        const messages: ChatMessage[] = [
            ...(systemMsg ? [systemMsg] : []),
            ...savedHistory,
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
