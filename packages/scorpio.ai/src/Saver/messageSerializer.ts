import { ChatMessage, ChatToolCall, MessageRole } from "./IAgentSaverService";

// ─── Token estimation ────────────────────────────────────────────────────────

function estimateLengthTokens(length: number): number {
    return Math.ceil(length * 0.75) + 4;
}

/** 中英文混合文本的保守近似；供预算判断使用，不代替供应商 tokenizer。 */
export function estimateTextTokens(text: string): number {
    return estimateLengthTokens(text.length);
}

export function estimateMessageTokens(message: ChatMessage): number {
    const content = message.content;
    let textLength = 0;

    if (typeof content === "string") {
        textLength = content.length;
    } else if (Array.isArray(content)) {
        for (const part of content) {
            if (typeof part === "string") {
                textLength += (part as string).length;
            } else if (part && typeof part === "object" && "text" in part) {
                textLength += part.text?.length ?? 0;
            }
        }
    }

    if (message.role === MessageRole.AI && message.tool_calls?.length) {
        for (const tc of message.tool_calls as ChatToolCall[]) {
            textLength += (tc.name?.length ?? 0) + JSON.stringify(tc.args ?? {}).length;
        }
    }

    return estimateLengthTokens(textLength);
}

/** 估算一组中性 ChatMessage 的总输入 token。 */
export function estimateMessagesTokens(messages: ChatMessage[]): number {
    return messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
}

