import fs from "fs";
import path from "path";
import { inject, T_SystemPrompts, T_OutputDir } from "../../Core";
import { IModelService } from "../../Model";
import { IAgentSaverService } from "../../Saver";
import { ILoggerService } from "../../Logger";
import { IMemoryService } from "../../Memory";
import { AgentServiceBase, IAgentCallback, ICancellationToken, AgentCancelledError, DEFAULT_MAX_HISTORY_TOKENS, ChatMessage, MessageRole } from "../AgentServiceBase";
import type { MessageContent } from "../../Saver/IAgentSaverService";

export { ChatMessage, MessageRole, IAgentCallback, ICancellationToken, AgentCancelledError } from "../AgentServiceBase";

/**
 * 纯生成式 Agent（图片/音频/视频等）
 * 无工具循环、无 system message 构建、无 memory/wiki 保存，单次模型调用后直接返回。
 */
export class GenerativeAgentService extends AgentServiceBase {
    protected modelService: IModelService;
    protected systemMessages: ChatMessage[];
    private outputDir?: string;

    constructor(
        @inject(IModelService) modelService: IModelService,
        @inject(T_SystemPrompts, { optional: true }) systemPrompts?: string[],
        @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService,
        @inject(IAgentSaverService, { optional: true }) agentSaver?: IAgentSaverService,
        @inject(IMemoryService, { optional: true }) memoryServices?: IMemoryService[],
        @inject(T_OutputDir, { optional: true }) outputDir?: string,
    ) {
        super(loggerService, agentSaver, memoryServices);
        this.modelService = modelService;
        this.systemMessages = (systemPrompts ?? []).map(p => ({ role: MessageRole.System, content: p }));
        this.outputDir = outputDir;
    }

    override addSystemPrompts(prompts: string[]): void {
        this.systemMessages.unshift(...prompts.map(p => ({ role: MessageRole.System, content: p })));
    }

    override async stream(query: MessageContent, callback: IAgentCallback, cancellationToken?: ICancellationToken): Promise<ChatMessage[]> {
        await this.saverService.pushMessage({ role: MessageRole.Human, content: query });

        const savedHistory = await this.saverService.getMessages(this.modelService.contextWindow ?? DEFAULT_MAX_HISTORY_TOKENS);
        if (!savedHistory || savedHistory.length === 0) {
            throw new Error('historyMessages is empty, cannot call model');
        }
        const messages: ChatMessage[] = [...this.systemMessages, ...savedHistory];

        if (cancellationToken?.isCancelled) throw new AgentCancelledError();
        const stream = await this.modelService.stream(messages);

        let lastChunk: ChatMessage | undefined;
        const emitStream = async () => {
            if (!callback?.onStreamMessage || !lastChunk) return;
            await callback.onStreamMessage(lastChunk);
        };
        let lastStreamCallTime = 0;
        for await (const chunk of stream) {
            if (cancellationToken?.isCancelled) throw new AgentCancelledError();
            lastChunk = chunk;
            const now = Date.now();
            if (now - lastStreamCallTime >= 200) {
                lastStreamCallTime = now;
                await emitStream();
            }
        }
        await emitStream();
        if (!lastChunk) return [];

        if (lastChunk.usage) {
            await callback?.onUsage?.(lastChunk.usage);
            delete lastChunk.usage;
        }

        const result: ChatMessage[] = [];

        if (this.outputDir) {
            const savedPaths = await this.saveInlineMedia(lastChunk.content);

            await this.saverService.pushMessage(lastChunk);
            if (callback.onMessage) await callback.onMessage(lastChunk);
            result.push(lastChunk);

            const text = savedPaths.length > 0
                ? `生成图片: ${savedPaths.join(', ')}`
                : '没有生成图片';
            const textMsg: ChatMessage = { role: MessageRole.AI, content: text };
            await this.saverService.pushMessage(textMsg);
            if (callback.onMessage) await callback.onMessage(textMsg);
            result.push(textMsg);
        } else {
            await this.saverService.pushMessage(lastChunk);
            if (callback.onMessage) await callback.onMessage(lastChunk);
            result.push(lastChunk);
        }

        return result;
    }

    /**
     * 提取 multimodal content 中的 inlineData，保存为文件，返回保存路径列表。
     * 原始 inlineData 保留在 content 中（供 channel 直接发送图片）。
     */
    private async saveInlineMedia(content: MessageContent): Promise<string[]> {
        if (typeof content === 'string' || !Array.isArray(content)) return [];

        const savedPaths: string[] = [];
        for (const part of content) {
            if (part.type !== 'inlineData' || !part.inlineData?.data) continue;
            try {
                const mime: string = part.inlineData.mimeType ?? 'application/octet-stream';
                const ext = mime.split('/')[1]?.split('+')[0] || 'bin';
                const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
                const filePath = path.join(this.outputDir!, filename);
                fs.mkdirSync(this.outputDir!, { recursive: true });
                fs.writeFileSync(filePath, Buffer.from(part.inlineData.data, 'base64'));
                savedPaths.push(filePath);
                this.logger?.info(`Saved media: ${filePath}`);
            } catch (e: any) {
                this.logger?.warn(`Failed to save inline media: ${e.message}`);
            }
        }

        return savedPaths;
    }
}
