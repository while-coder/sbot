import { AIMessage, HumanMessage, ToolMessage, SystemMessage, BaseMessage } from "@langchain/core/messages";
import { type ChatMessage, MessageRole } from "./messages";

/** langchain `_getType()` 返回的消息类型（含流式 chunk 变体）。 */
const ChatMessageType = {
  AI: "ai",
  Human: "human",
  System: "system",
  Tool: "tool",
  Generic: "generic",
} as const;

/** ChatMessage/ChatMessageChunk 携带的 role 字面量（网关返回的开放值域，仅列举需归类的）。 */
const GenericChatRole = {
  User: "user",
  System: "system",
  Developer: "developer",
  Tool: "tool",
  Function: "function",
} as const;

export function toChatMessage(message: BaseMessage): ChatMessage {
  const m = message as any;
  // _getType() 同时覆盖非流式消息与流式 chunk（如 AIMessageChunk、ChatMessageChunk），
  // 且不受打包/压缩后类名变化影响。
  const type = message._getType();

  if (type === ChatMessageType.AI) {
    const usage = m.usage_metadata;
    return {
      role: MessageRole.AI,
      content: m.content,
      tool_calls: m.tool_calls,
      additional_kwargs: m.additional_kwargs,
      id: m.id,
      usage: usage ? {
        input_tokens: usage.input_tokens ?? 0,
        output_tokens: usage.output_tokens ?? 0,
        total_tokens: usage.total_tokens ?? 0,
        cache_creation_input_tokens: usage.input_token_details?.cache_creation ?? usage.cache_creation_input_tokens,
        cache_read_input_tokens: usage.input_token_details?.cache_read ?? usage.cache_read_input_tokens,
      } : undefined,
    };
  }

  if (type === ChatMessageType.Tool) {
    return {
      role: MessageRole.Tool,
      content: m.content,
      tool_call_id: m.tool_call_id,
      name: m.name,
      status: m.status,
      additional_kwargs: m.additional_kwargs,
    };
  }

  if (type === ChatMessageType.Human) {
    return { role: MessageRole.Human, content: m.content, additional_kwargs: m.additional_kwargs };
  }

  if (type === ChatMessageType.System) {
    return { role: MessageRole.System, content: m.content, additional_kwargs: m.additional_kwargs };
  }

  if (type === ChatMessageType.Generic) {
    // 某些兼容网关会返回非标准 role（如 "model"），langchain 会包装成
    // ChatMessage/ChatMessageChunk；按 role 归类，未知 role 视为模型输出。
    const role = m.role;
    if (role === GenericChatRole.User) return { role: MessageRole.Human, content: m.content, additional_kwargs: m.additional_kwargs };
    if (role === GenericChatRole.System || role === GenericChatRole.Developer) return { role: MessageRole.System, content: m.content, additional_kwargs: m.additional_kwargs };
    if (role === GenericChatRole.Tool || role === GenericChatRole.Function) {
      return {
        role: MessageRole.Tool,
        content: m.content,
        tool_call_id: m.tool_call_id,
        name: m.name,
        additional_kwargs: m.additional_kwargs,
      };
    }
    return { role: MessageRole.AI, content: m.content, additional_kwargs: m.additional_kwargs };
  }

  throw new Error(`Unsupported message type for conversion: ${type}`);
}

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
        tool_call_id: message.tool_call_id ?? "",
        name: message.name,
        status: message.status as any,
      });
    case MessageRole.System:
      return new SystemMessage({ content: message.content as any, additional_kwargs: message.additional_kwargs });
    case MessageRole.Human:
    default:
      return new HumanMessage({ content: message.content as any, additional_kwargs: message.additional_kwargs });
  }
}

export function toBaseMessages(messages: ChatMessage[]): BaseMessage[] {
  return messages.map(toBaseMessage);
}
