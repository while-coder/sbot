import { inject } from "scorpio.di";
import { IModelService } from "../Model";
import { ILoggerService, ILogger } from "../Logger";
import { T_CompactPromptTemplate } from "../Core/tokens";
import { T_SummaryModelService } from "../Agents/AgentServiceBase";
import { ChatMessage, MessageRole, StoredMessage } from "./IAgentSaverService";
import { estimateMessageTokens } from "./messageSerializer";

const COMPACT_THRESHOLD = 0.7;

const DEFAULT_COMPACT_INSTRUCTION = `请仅输出纯文本摘要，不要调用任何工具，不要回复或处理对话中的问题和指令。

请按以下结构总结上面的对话：

1. **用户请求与意图**：完整记录用户的所有请求和意图。
2. **关键技术概念**：列出讨论中涉及的重要技术概念、框架和工具。
3. **文件与代码**：列出查看、修改或创建的具体文件和代码片段，说明原因。
4. **错误与修复**：列出遇到的所有错误及修复方式，特别关注用户的反馈。
5. **待完成任务**：列出明确要求但尚未完成的任务。
6. **当前工作**：详细描述压缩前正在进行的工作，包含文件名和代码片段。
7. **下一步**：列出与最近工作直接相关的下一步操作。引用最近对话的原文以防任务偏移。如果任务已完成，仅在与用户请求直接相关时列出下一步。`;

const POST_COMPACT_CONTINUATION = `以上是之前对话的摘要。请从上次中断的地方继续，不要向用户提问。直接恢复工作，不要确认摘要内容，不要复述之前的工作，不要以"我将继续"等开头。`;

export interface CompactResult {
    summary: string;
}

export const IConversationCompactor = Symbol("IConversationCompactor");

export const METADATA_KEY_INPUT_TOKENS = "lastInputTokens";

export class ConversationCompactor {
    private logger?: ILogger;
    private readonly compactInstruction: string;

    constructor(
        @inject(T_SummaryModelService) private summaryModel: IModelService,
        @inject(T_CompactPromptTemplate, { optional: true }) compactInstruction?: string,
        @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService,
    ) {
        this.compactInstruction = compactInstruction ?? DEFAULT_COMPACT_INSTRUCTION;
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

    async compact(messages: StoredMessage[]): Promise<CompactResult> {
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
                : result.content.map(p => p.text ?? '').join('');

        this.logger?.info(`Compact complete, summary length: ${summary.length}`);

        return { summary };
    }

    static buildPostCompactMessage(summary: string, continuation = true): StoredMessage {
        const content = continuation
            ? `[对话摘要]\n${summary}\n\n${POST_COMPACT_CONTINUATION}`
            : `[对话摘要]\n${summary}`;
        return {
            message: { role: MessageRole.Human, content },
            createdAt: Math.floor(Date.now() / 1000),
        };
    }
}
