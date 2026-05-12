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

