import {
    AIMessage,
    BaseMessage,
    HumanMessage,
    ToolMessage,
} from "langchain";

export enum MessageType {
    Human = "human",
    AI    = "ai",
    Tool  = "tool",
}

export function serializeMessage(message: BaseMessage): { type: MessageType; data: string } {
    const name = message.constructor.name;
    const m = message as any;
    if (name === 'AIMessage') {
        return {
            type: MessageType.AI,
            data: JSON.stringify({
                content: m.content,
                tool_calls: m.tool_calls,
                additional_kwargs: m.additional_kwargs,
                id: m.id,
            }),
        };
    }
    if (name === 'ToolMessage') {
        return {
            type: MessageType.Tool,
            data: JSON.stringify({
                content: m.content,
                tool_call_id: m.tool_call_id,
                name: m.name,
                status: m.status,
            }),
        };
    }
    if (name === 'HumanMessage') {
        return {
            type: MessageType.Human,
            data: JSON.stringify({
                content: m.content,
                additional_kwargs: m.additional_kwargs,
            }),
        };
    }
    throw new Error(`未知消息类型: ${name}`);
}

export function deserializeMessage(type: MessageType, data: string): BaseMessage {
    const d = JSON.parse(data);
    switch (type) {
        case MessageType.AI:
            return new AIMessage({
                content: d.content,
                tool_calls: d.tool_calls,
                additional_kwargs: d.additional_kwargs,
                id: d.id,
            });
        case MessageType.Tool:
            return new ToolMessage({
                content: d.content,
                tool_call_id: d.tool_call_id,
                name: d.name,
                status: d.status,
            });
        default: // MessageType.Human
            return new HumanMessage({
                content: d.content ?? "",
                additional_kwargs: d.additional_kwargs,
            });
    }
}

export function estimateMessageTokens(message: BaseMessage): number {
    const content = message.content;
    let textLength = 0;

    if (typeof content === "string") {
        textLength = content.length;
    } else if (Array.isArray(content)) {
        for (const part of content as any[]) {
            if (typeof part === "string") {
                textLength += part.length;
            } else if (part && typeof part === "object" && "text" in part) {
                textLength += part.text?.length ?? 0;
            }
        }
    }

    if (message instanceof AIMessage && message.tool_calls?.length) {
        for (const tc of message.tool_calls) {
            textLength += (tc.name?.length ?? 0) + JSON.stringify(tc.args ?? {}).length;
        }
    }

    return Math.ceil(textLength * 0.75) + 4;
}

/**
 * 从消息数组末尾截取不超过 maxTokens 的部分，
 * 并丢弃开头的孤立 ToolMessage（其配对的 AIMessage 已被截断）
 */
export function applyTokenLimit(messages: BaseMessage[], maxTokens: number): BaseMessage[] {
    let tokenCount = 0;
    let startIndex = messages.length;

    for (let i = messages.length - 1; i >= 0; i--) {
        const tokens = estimateMessageTokens(messages[i]);
        if (tokenCount + tokens > maxTokens) break;
        tokenCount += tokens;
        startIndex = i;
    }

    while (startIndex < messages.length && messages[startIndex] instanceof ToolMessage) {
        startIndex++;
    }

    return messages.slice(startIndex);
}
