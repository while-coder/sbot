import { AIMessage, HumanMessage, ToolMessage, BaseMessage } from "langchain";
import { ChatMessage, MessageRole } from "./IAgentSaverService";

/**
 * LangChain BaseMessage → ChatMessage（框架无关）
 *
 * 这是唯一需要依赖 LangChain 的转换边界，
 * 所有 Saver 实现和非 Agent 消费方均不需要导入此文件。
 */
export function toChatMessage(message: BaseMessage): ChatMessage {
    const m = message as any;
    const name = message.constructor.name;

    if (name === 'AIMessage' || name === 'AIMessageChunk') {
        return {
            role: MessageRole.AI,
            content: m.content,
            tool_calls: m.tool_calls,
            additional_kwargs: m.additional_kwargs,
            id: m.id,
        };
    }

    if (name === 'ToolMessage') {
        return {
            role: MessageRole.Tool,
            content: m.content,
            tool_call_id: m.tool_call_id,
            name: m.name,
            status: m.status,
            additional_kwargs: m.additional_kwargs,
        };
    }

    if (name === 'HumanMessage') {
        return {
            role: MessageRole.Human,
            content: m.content,
            additional_kwargs: m.additional_kwargs,
        };
    }

    throw new Error(`Unsupported message type for conversion: ${name}`);
}

/**
 * ChatMessage（框架无关）→ LangChain BaseMessage
 *
 * 用于将持久化历史重新喂给 LangChain 图执行。
 */
export function toBaseMessage(message: ChatMessage): BaseMessage {
    switch (message.role) {
        case MessageRole.AI:
            return new AIMessage({
                content: message.content as any,
                tool_calls: message.tool_calls as any,
                additional_kwargs: message.additional_kwargs,
                id: message.id,
            });
        case MessageRole.Tool:
            return new ToolMessage({
                content: message.content as any,
                tool_call_id: message.tool_call_id ?? '',
                name: message.name,
                status: message.status as any,
            });
        case MessageRole.Human:
        default:
            return new HumanMessage({
                content: message.content as any,
                additional_kwargs: message.additional_kwargs,
            });
    }
}

/**
 * ChatMessage[] → BaseMessage[]（批量转换）
 */
export function toBaseMessages(messages: ChatMessage[]): BaseMessage[] {
    return messages.map(toBaseMessage);
}
