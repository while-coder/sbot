import { type BaseMessage } from "@langchain/core/messages";
import { toJsonSchema } from "@langchain/core/utils/json_schema";
import { type ChatMessage, MessageRole } from "../Saver/IAgentSaverService";
import { toBaseMessages } from "../Saver/messageConverter";
import { type StructuredInvokeOptions } from "./IModelService";

export enum StructuredOutputMethod {
  FunctionCalling = "functionCalling",
  JsonMode = "jsonMode",
  JsonSchema = "jsonSchema",
}

const JSON_MODE_INSTRUCTION = [
  "Return only valid JSON that matches the requested schema.",
  "Do not include markdown, code fences, or any extra text.",
].join(" ");

export function getInvokeConfig(options: StructuredInvokeOptions | undefined): { signal: AbortSignal } | undefined {
  return options?.signal ? { signal: options.signal } : undefined;
}

export function toStructuredInput(
  prompt: string | ChatMessage[],
  method: StructuredOutputMethod,
  schema?: any,
): string | BaseMessage[] {
  const input = method === StructuredOutputMethod.JsonMode
    ? withJsonModeInstruction(prompt, schema)
    : prompt;
  return typeof input === 'string' ? input : toBaseMessages(input);
}

function withJsonModeInstruction(prompt: string | ChatMessage[], schema?: any): string | ChatMessage[] {
  const instruction = jsonModeInstruction(schema);
  if (typeof prompt === 'string') {
    return `${instruction}\n\n${prompt}`;
  }

  const systemIndex = prompt.findIndex(message => message.role === MessageRole.System);
  if (systemIndex < 0 || typeof prompt[systemIndex].content !== 'string') {
    return [
      { role: MessageRole.System, content: instruction },
      ...prompt,
    ];
  }

  return prompt.map((message, index) => index === systemIndex
    ? { ...message, content: `${message.content}\n\n${instruction}` }
    : message
  );
}

function jsonModeInstruction(schema?: any): string {
  if (schema == null) return JSON_MODE_INSTRUCTION;
  try {
    return [
      JSON_MODE_INSTRUCTION,
      "The JSON object must satisfy this JSON Schema:",
      JSON.stringify(toJsonSchema(schema)),
    ].join("\n");
  } catch {
    return JSON_MODE_INSTRUCTION;
  }
}
