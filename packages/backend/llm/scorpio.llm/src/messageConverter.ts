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
  return sanitizeBaseMessages(messages.map(toBaseMessage));
}

/**
 * 清理发往模型的消息中的空内容（工具空结果、历史残留的空文本 part、整条空消息）。
 * 空内容对任何 provider 都是垃圾数据，且部分 API 直接 400：
 * Anthropic 报 "text content blocks must be non-empty"，Gemini 报
 * "Part.text must not be empty"，部分 OpenAI 兼容网关同样严格。
 * - ToolMessage：空内容替换为占位文本（tool_result 必须与 tool_use 配对，不能丢）
 * - 其余消息：剔除空文本 part；剔除后无内容且无 tool_calls 的消息直接丢弃
 */
function sanitizeBaseMessages(messages: BaseMessage[]): BaseMessage[] {
  const result: BaseMessage[] = [];
  for (const message of messages) {
    const hasToolCalls = message instanceof AIMessage && !!message.tool_calls?.length;
    if (Array.isArray(message.content)) {
      const filtered = message.content.filter((part: any) => part?.type !== "text" || (typeof part.text === "string" && part.text.trim().length > 0));
      if (filtered.length === 0) {
        // ToolMessage 不能丢（tool_result 必须与 tool_use 配对），换成占位文本；
        // 其余消息无内容且无 tool_calls 时直接丢弃
        if (message instanceof ToolMessage) message.content = "(empty tool output)";
        else if (!hasToolCalls) continue;
      } else {
        message.content = filtered;
      }
    } else if (message.content == null || message.content === "") {
      if (message instanceof ToolMessage) message.content = "(empty tool output)";
      else if (!hasToolCalls) continue;
    }
    result.push(message);
  }
  return result;
}
