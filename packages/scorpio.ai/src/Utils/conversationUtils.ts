import { type ChatMessage, MessageRole } from "../Saver";
import { contentToString } from "./contentUtils";

/**
 * 把一组 ChatMessage 渲染成可喂给后台 LLM（MemoryWriter / AgendaExtractor 等）的纯文本 transcript。
 *
 * - human → `human: ...`
 * - ai → `ai: ...`，含 tool_calls 时附 `\n  tool_calls: name(args), ...`；纯 tool_calls 无文本时变 `ai (tool_calls): ...`
 * - tool → `tool[name][status]: ...`
 * - system → 跳过
 *
 * 为什么共享：Memory 与 Agenda 的后台抽取 LLM 都用同一形态的 transcript 作为输入，
 * 抽到一个工具里避免两份实现漂移。tool_call args 通过 safeJson 截断到 2k，避免大 payload 喂到 LLM。
 */
export function renderConversation(messages: ChatMessage[]): string {
    const lines: string[] = [];
    for (const msg of messages) {
        const line = renderMessage(msg);
        if (line) lines.push(line);
    }
    return lines.join("\n\n");
}

function renderMessage(msg: ChatMessage): string | null {
    const role = roleLabel(msg.role);
    if (!role) return null;
    const text = contentToString(msg.content) || "";

    if (msg.role === MessageRole.AI && msg.tool_calls && msg.tool_calls.length > 0) {
        const calls = msg.tool_calls.map(c => `${c.name}(${safeJson(c.args)})`).join(", ");
        if (text) return `ai: ${text}\n  tool_calls: ${calls}`;
        return `ai (tool_calls): ${calls}`;
    }

    if (msg.role === MessageRole.Tool) {
        const name = msg.name ?? "tool";
        const status = msg.status ? ` [${msg.status}]` : "";
        return `tool[${name}]${status}: ${text}`;
    }

    return `${role}: ${text}`;
}

function roleLabel(role: MessageRole): string | null {
    switch (role) {
        case MessageRole.Human:  return "human";
        case MessageRole.AI:     return "ai";
        case MessageRole.Tool:   return "tool";
        case MessageRole.System: return null;  // system 不进 transcript
        default:                 return null;
    }
}

function safeJson(value: unknown): string {
    try {
        const s = JSON.stringify(value);
        if (s == null) return "";
        return s.length > 2048 ? s.slice(0, 2048) + "...<truncated>" : s;
    } catch {
        return "<unserializable>";
    }
}
