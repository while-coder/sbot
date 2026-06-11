import { inject } from "scorpio.di";
import { IModelService } from "../Model";
import { ILoggerService, ILogger } from "../Logger";
import { T_CompactPromptTemplate, T_PostCompactMessageTemplate, T_PostCompactContinuation } from "../Core/tokens";
import { T_SummaryModelService } from "../Agents/AgentServiceBase";
import { ChatMessage, ContentPartType, MessageKind, MessageRole, NewStoredMessage, StoredMessage } from "./IAgentSaverService";
import { estimateMessageTokens } from "./messageSerializer";

const COMPACT_THRESHOLD = 0.7;

export const IConversationCompactor = Symbol("IConversationCompactor");

export const METADATA_KEY_INPUT_TOKENS = "lastInputTokens";

export class ConversationCompactor {
    private logger?: ILogger;
    private readonly compactInstruction: string;
    private readonly postMessageTemplate: string;
    private readonly postContinuation: string;

    constructor(
        @inject(T_SummaryModelService) private summaryModel: IModelService,
        @inject(T_CompactPromptTemplate) compactInstruction: string,
        @inject(T_PostCompactMessageTemplate) postMessageTemplate: string,
        @inject(T_PostCompactContinuation) postContinuation: string,
        @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService,
    ) {
        this.compactInstruction = compactInstruction;
        this.postMessageTemplate = postMessageTemplate;
        this.postContinuation = postContinuation;
        this.logger = loggerService?.getLogger("ConversationCompactor");
    }

    shouldCompact(lastInputTokens: number, messages: StoredMessage[], contextWindow: number): boolean {
        let tokens: number;
        if (lastInputTokens > 0) {
            const lastMsg = messages[messages.length - 1];
            const newTokens = lastMsg ? estimateMessageTokens(lastMsg.message) : 0;
            tokens = lastInputTokens + newTokens;
        } else {
            tokens = messages.reduce((sum, s) => sum + estimateMessageTokens(s.message), 0);
        }
        return tokens > contextWindow * COMPACT_THRESHOLD;
    }

    /**
     * 调用模型生成摘要，并按模板包装成可直接写入 saver 的压缩后消息。
     * @param continuation true（默认）追加续作指令，让 Agent 自动接续；false 仅保留摘要正文。
     */
    async compact(messages: StoredMessage[], continuation = true): Promise<NewStoredMessage> {
        const chatMessages: ChatMessage[] = [
            ...messages.map(s => s.message),
            { role: MessageRole.Human, content: this.compactInstruction },
        ];

        this.logger?.info(`Compacting ${messages.length} messages`);

        const stream = await this.summaryModel.stream(chatMessages);
        let result: ChatMessage | undefined;
        for await (const chunk of stream) {
            result = chunk;
        }

        const summary = !result ? '' :
            typeof result.content === 'string'
                ? result.content
                : result.content.map(p => (p.type === ContentPartType.Text ? (p.text ?? '') : '')).join('');

        this.logger?.info(`Compact complete, summary length: ${summary.length}`);

        const body = this.postMessageTemplate.replaceAll('{summary}', summary);
        const content = continuation ? `${body}\n\n${this.postContinuation}` : body;
        return {
            message: { role: MessageRole.Human, content },
            kind: MessageKind.Normal,
        };
    }
}
