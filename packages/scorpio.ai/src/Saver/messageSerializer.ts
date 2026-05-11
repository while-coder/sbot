import { ChatMessage, ChatToolCall, MessageRole } from "./IAgentSaverService";

// ─── Token estimation ────────────────────────────────────────────────────────

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

    return Math.ceil(textLength * 0.75) + 4;
}

/**
 * 从消息数组末尾截取不超过 maxTokens 的部分，
 * 并丢弃开头的孤立 tool 消息（其配对的 AI 消息已被截断）
 */
export function applyTokenLimit(messages: ChatMessage[], maxTokens: number): ChatMessage[] {
    if (messages.length === 0) return messages;

    let tokenCount = 0;
    let startIndex = messages.length;

    for (let i = messages.length - 1; i >= 0; i--) {
        const tokens = estimateMessageTokens(messages[i]);
        if (tokenCount + tokens > maxTokens) break;
        tokenCount += tokens;
        startIndex = i;
    }

    // 跳过开头孤立的 tool 消息（其配对的 AI tool_calls 已被截断）
    while (startIndex < messages.length && messages[startIndex].role === MessageRole.Tool) {
        startIndex++;
    }

    if (startIndex >= messages.length) {
        // 所有保留的消息都是孤立 Tool，需要回退到其父 AI 消息以保持配对完整
        let i = messages.length - 1;
        while (i >= 0 && messages[i].role === MessageRole.Tool) {
            i--;
        }
        startIndex = Math.max(0, i);
    }

    return messages.slice(startIndex);
}
