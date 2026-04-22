import { inject, T_SystemPrompts } from "../../Core";
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

    constructor(
        @inject(IModelService) modelService: IModelService,
        @inject(T_SystemPrompts, { optional: true }) systemPrompts?: string[],
        @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService,
        @inject(IAgentSaverService, { optional: true }) agentSaver?: IAgentSaverService,
        @inject(IMemoryService, { optional: true }) memoryServices?: IMemoryService[],
    ) {
        super(loggerService, agentSaver, memoryServices);
        this.modelService = modelService;
        this.systemMessages = (systemPrompts ?? []).map(p => ({ role: MessageRole.System, content: p }));
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
        const result = await this.modelService.invoke(messages);

        if (result.usage) {
            await callback?.onUsage?.(result.usage);
            delete result.usage;
        }

        await this.saverService.pushMessage(result);
        if (callback.onMessage) await callback.onMessage(result);

        return [result];
    }
}
