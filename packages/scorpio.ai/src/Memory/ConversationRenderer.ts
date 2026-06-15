import { type ChatMessage, type StoredMessage, MessageRole } from "../Saver";
import { contentToString } from "../Utils/contentUtils";

/**
 * 把 saver 里的消息列表渲染成可喂给 MemoryLLM 的纯文本 transcript。
 *
 * 输出示例：
 *   [2026-06-11T10:23:45.000Z] human: 帮我看下这个 bug
 *   [2026-06-11T10:23:46.500Z] ai (tool_calls): read_file({"path":"foo.ts"})
 *   [2026-06-11T10:23:46.700Z] tool[read_file]: <result snippet>
 *   [2026-06-11T10:24:01.000Z] ai: 我看到问题在第 12 行...
 */
export function renderConversation(messages: StoredMessage[]): string {
    const lines: string[] = [];
    for (const m of messages) {
        const ts = new Date(m.createdAt).toISOString();
        const line = renderMessage(ts, m.message);
        if (line) lines.push(line);
    }
    return lines.join("\n\n");
}

function renderMessage(ts: string, msg: ChatMessage): string | null {
    const role = roleLabel(msg.role);
    if (!role) return null;
    const text = contentToString(msg.content) || "";

    if (msg.role === MessageRole.AI && msg.tool_calls && msg.tool_calls.length > 0) {
        const calls = msg.tool_calls.map(c => `${c.name}(${safeJson(c.args)})`).join(", ");
        if (text) {
            return `[${ts}] ai: ${text}\n  tool_calls: ${calls}`;
        }
        return `[${ts}] ai (tool_calls): ${calls}`;
    }

    if (msg.role === MessageRole.Tool) {
        const name = msg.name ?? "tool";
        const status = msg.status ? ` [${msg.status}]` : "";
        return `[${ts}] tool[${name}]${status}: ${text}`;
    }

    return `[${ts}] ${role}: ${text}`;
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

/** 统计 user → assistant 的来回轮数（用于抽取 job 元数据）。 */
export function countTurns(messages: StoredMessage[]): number {
    let turns = 0;
    let lastWasHuman = false;
    for (const m of messages) {
        if (m.message.role === MessageRole.Human) {
            lastWasHuman = true;
        } else if (m.message.role === MessageRole.AI && lastWasHuman) {
            turns++;
            lastWasHuman = false;
        }
    }
    return turns;
}
