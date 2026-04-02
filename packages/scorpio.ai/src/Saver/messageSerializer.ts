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
 * 并修复可能破坏 tool_calls / tool_result 配对的截断：
 *   1. 丢弃开头的孤立 tool 消息（其配对的 AI 消息已被截断）
 *   2. 移除缺少后续 tool_result 的 AI(tool_calls) 消息
 *      （常见于上次执行中途出错或被取消的场景）
 */
export function applyTokenLimit(messages: ChatMessage[], maxTokens: number): ChatMessage[] {
    let tokenCount = 0;
    let startIndex = messages.length;

    for (let i = messages.length - 1; i >= 0; i--) {
        const tokens = estimateMessageTokens(messages[i]);
        if (tokenCount + tokens > maxTokens) break;
        tokenCount += tokens;
        startIndex = i;
    }

    while (startIndex < messages.length && messages[startIndex].role === MessageRole.Tool) {
        startIndex++;
    }

    // 保证至少返回最后 1 条消息
    if (startIndex >= messages.length) {
        startIndex = messages.length - 1;
    }

    const result = messages.slice(startIndex);

    // 移除缺少 tool_result 配对的 AI(tool_calls) 消息
    return stripOrphanedToolCalls(result);
}

/**
 * 扫描消息列表，移除任何 AI 消息中 tool_calls 没有对应 tool_result 的消息。
 * 当上次执行中途出错 / 取消时，saver 里可能残留这样的孤立 AI 消息。
 */
function stripOrphanedToolCalls(messages: ChatMessage[]): ChatMessage[] {
    const cleaned: ChatMessage[] = [];
    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        if (msg.role === MessageRole.AI && msg.tool_calls?.length) {
            // 收集紧随其后的所有 tool_result id
            const resultIds = new Set<string>();
            for (let j = i + 1; j < messages.length && messages[j].role === MessageRole.Tool; j++) {
                if (messages[j].tool_call_id) resultIds.add(messages[j].tool_call_id!);
            }
            // 如果任何 tool_call 缺少对应的 tool_result，丢弃这条 AI 消息
            const allMatched = msg.tool_calls.every(tc => !tc.id || resultIds.has(tc.id));
            if (!allMatched) continue;
        }
        cleaned.push(msg);
    }
    return cleaned;
}
