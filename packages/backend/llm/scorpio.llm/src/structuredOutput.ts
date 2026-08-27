import { type ChatMessage, MessageRole } from "./messages";
import { toJsonSchema } from "./tools";

export enum StructuredOutputMethod {
  FunctionCalling = "functionCalling",
  JsonMode = "jsonMode",
  JsonSchema = "jsonSchema",
}

const JSON_MODE_INSTRUCTION = [
  "Return only valid JSON that matches the requested schema.",
  "Do not include markdown, code fences, or any extra text.",
].join(" ");

/**
 * 在 prompt 中注入 JSON mode 指令（含 schema 序列化）。
 * 无 system 消息时前置，有则追加到其后。
 */
export function withJsonModeInstruction(prompt: string | ChatMessage[], schema?: any): string | ChatMessage[] {
  const instruction = jsonModeInstruction(schema);
  if (typeof prompt === "string") return `${instruction}\n\n${prompt}`;

  const systemIndex = prompt.findIndex(message => message.role === MessageRole.System);
  if (systemIndex < 0 || typeof prompt[systemIndex].content !== "string") {
    return [{ role: MessageRole.System, content: instruction }, ...prompt];
  }
  return prompt.map((message, index) => index === systemIndex
    ? { ...message, content: `${message.content}\n\n${instruction}` }
    : message);
}

function jsonModeInstruction(schema?: any): string {
  if (schema == null) return JSON_MODE_INSTRUCTION;
  try {
    return [JSON_MODE_INSTRUCTION, "The JSON object must satisfy this JSON Schema:", JSON.stringify(toJsonSchema(schema))].join("\n");
  } catch {
    return JSON_MODE_INSTRUCTION;
  }
}
