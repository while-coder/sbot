import OpenAI from "openai";
import type {
  FunctionTool,
  Response,
  ResponseCreateParamsNonStreaming,
  ResponseFunctionToolCall,
  ResponseInput,
  ResponseInputContent,
  ResponseOutputItem,
  ResponseStreamEvent,
} from "openai/resources/responses/responses";
import {
  type ChatMessage,
  type ChatToolCall,
  type IModelService,
  type ModelInvokeOptions,
  type StructuredInvokeOptions,
  ContentPartType,
  MessageRole,
  toJsonSchema,
  withJsonModeInstruction,
} from "scorpio.llm";
import { OpenAIServiceBase } from "./OpenAIServiceBase";

const RESPONSE_OUTPUT_KEY = "openai_response_output";
const FUNCTION_CALL_IDS_KEY = "__openai_function_call_ids__";
const EMPTY_TOOL_OUTPUT = "(empty tool output)";

type ReplayMode = "preserve" | "call_id_only";

/**
 * Responses API 原生实现。
 *
 * 与 ChatMessage 之间只做应用边界转换；模型返回的完整 output items 会原样
 * 存入 additional_kwargs，后续轮次再原样回放，避免 reasoning/function_call
 * 经过中间表示后丢失关联信息。
 */
export class OpenAIResponseModelService extends OpenAIServiceBase implements IModelService {
  private tools: FunctionTool[] = [];

  override async dispose(): Promise<void> {
    await super.dispose();
    this.tools = [];
  }

  bindTools(tools: any[]): void {
    this.assertInitialized();
    this.tools = tools.map(tool => ({
      type: "function",
      name: tool.name,
      description: tool.description || undefined,
      parameters: toJsonSchema(tool.schema) as Record<string, unknown>,
      strict: false,
    }));
  }

  async invoke(prompt: string | ChatMessage[], options?: ModelInvokeOptions): Promise<ChatMessage> {
    const response = await this.responses.create(this.createParams(prompt), this.requestOptions(options));
    return this.toChatMessage(response);
  }

  async stream(prompt: string | ChatMessage[], options?: ModelInvokeOptions): Promise<AsyncIterable<ChatMessage>> {
    const stream = await this.responses.create(
      { ...this.createParams(prompt), stream: true },
      this.requestOptions(options),
    );
    const service = this;

    return (async function* () {
      let responseId: string | undefined;
      let outputText = "";
      const calls = new Map<number, ResponseFunctionToolCall>();
      const doneItems = new Map<number, ResponseOutputItem>();
      let yieldedFinal = false;
      let pendingText = "";

      for await (const event of stream as AsyncIterable<ResponseStreamEvent>) {
        switch (event.type) {
          case "response.created":
          case "response.in_progress":
            responseId = event.response.id;
            break;
          case "response.output_text.delta":
            outputText += event.delta;
            pendingText += event.delta;
            yield service.toStreamingMessage(responseId, outputText, calls);
            break;
          case "response.output_item.added":
            if (event.item.type === "function_call") {
              calls.set(event.output_index, { ...event.item });
              yield service.toStreamingMessage(responseId, outputText, calls);
            }
            break;
          case "response.output_item.done": {
            doneItems.set(event.output_index, event.item);
            if (event.item.type === "message") {
              // 该 item 已完整落到 doneItems，从待累计文本中剔除，避免兜底 content 重复
              const itemText = event.item.content
                .map(part => (part.type === "output_text" ? part.text : part.type === "refusal" ? part.refusal : ""))
                .join("");
              if (itemText && pendingText.endsWith(itemText)) {
                pendingText = pendingText.slice(0, -itemText.length);
              }
            }
            if (event.item.type === "function_call") {
              calls.set(event.output_index, { ...event.item });
              yield service.toStreamingMessage(responseId, outputText, calls);
            }
            break;
          }
          case "response.function_call_arguments.delta": {
            const current = calls.get(event.output_index);
            if (current) {
              current.arguments += event.delta;
              yield service.toStreamingMessage(responseId, outputText, calls);
            }
            break;
          }
          case "response.completed":
          case "response.incomplete":
            yieldedFinal = true;
            yield service.toChatMessage(event.response);
            break;
          case "response.failed":
            throw new Error(event.response.error?.message ?? "OpenAI Responses request failed");
          case "error":
            throw new Error(event.message);
        }
      }

      if (!yieldedFinal && (outputText || doneItems.size > 0 || calls.size > 0)) {
        // 流被中断（未收到 response.completed）时的兜底：尽量还原 output items 存入
        // additional_kwargs，否则下一轮回放会出现无 reasoning 配对的 function_call。
        const items = [...doneItems.entries()]
          .sort(([a], [b]) => a - b)
          .map(([, item]) => item);
        for (const [index, call] of calls) {
          if (!doneItems.has(index)) items.push(call as unknown as ResponseOutputItem);
        }
        yield service.toFinalMessage(responseId, pendingText, items);
      }
    })();
  }

  async invokeStructured<T = any>(
    schema: any,
    prompt: string | ChatMessage[],
    options?: StructuredInvokeOptions,
  ): Promise<T> {
    const jsonSchema = toJsonSchema(schema) as Record<string, unknown>;
    try {
      const response = await this.responses.create({
        ...this.createParams(prompt, false),
        text: {
          format: { type: "json_schema", name: "structured_output", schema: jsonSchema, strict: options?.strict ?? true },
        },
      }, this.requestOptions(options));
      return this.parseStructuredOutput<T>(response.output_text);
    } catch (error) {
      if (!this.shouldFallbackStructured(options, error)) throw error;
      // 退化为 JSON mode：指令注入 schema，靠提示词约束输出
      const response = await this.responses.create({
        ...this.createParams(withJsonModeInstruction(prompt, jsonSchema), false),
        text: { format: { type: "json_object" } },
      }, this.requestOptions(options));
      return this.parseStructuredOutput<T>(response.output_text);
    }
  }

  private get responses(): OpenAI["responses"] {
    this.assertInitialized();
    return this.client!.responses;
  }

  private get replayMode(): ReplayMode {
    return this.config.config?.responseItemReplay === "call_id_only" ? "call_id_only" : "preserve";
  }

  private createParams(prompt: string | ChatMessage[], includeTools = true): ResponseCreateParamsNonStreaming {
    const info = this.getLLMInfo();
    const maxOutputTokens = this.config.maxTokens ?? (info.fromCatalog ? info.maxOutputTokens : undefined);
    return {
      model: this.config.model,
      input: this.toResponseInput(prompt),
      store: false,
      ...(this.replayMode === "preserve" && { include: ["reasoning.encrypted_content" as const] }),
      ...(includeTools && this.tools.length > 0 && { tools: this.tools }),
      ...(info.temperature !== false && this.config.temperature != null && { temperature: this.config.temperature }),
      ...(maxOutputTokens != null && { max_output_tokens: maxOutputTokens }),
    };
  }

  private toResponseInput(prompt: string | ChatMessage[]): string | ResponseInput {
    if (typeof prompt === "string") return prompt;

    const input: ResponseInput = [];
    for (const message of prompt) {
      if (message.role === MessageRole.Tool) {
        if (!message.tool_call_id) throw new Error("OpenAI Responses tool message missing tool_call_id");
        input.push({
          type: "function_call_output",
          call_id: message.tool_call_id,
          output: this.toolOutput(message.content),
        });
      } else if (message.role === MessageRole.AI) {
        this.appendAssistantInput(input, message);
      } else {
        const content = this.toInputContent(message.content);
        if (content.length > 0) {
          input.push({ type: "message", role: message.role === MessageRole.System ? "system" : "user", content });
        }
      }
    }
    return input;
  }

  private appendAssistantInput(input: ResponseInput, message: ChatMessage): void {
    if (this.replayMode === "preserve") {
      const rawOutput = message.additional_kwargs?.[RESPONSE_OUTPUT_KEY];
      if (Array.isArray(rawOutput) && rawOutput.every(this.isResponseOutputItem)) {
        // SDK 的 output/input 联合类型在少数内置工具状态上不完全重合，
        // 但 Responses 协议明确允许把 response.output 原样作为下一轮 input。
        input.push(...rawOutput as any[]);
        return;
      }
    }

    const reasoning = this.replayMode === "preserve" ? message.additional_kwargs?.reasoning : undefined;
    const reasoningItems = Array.isArray(reasoning) ? reasoning : reasoning ? [reasoning] : [];
    for (const item of reasoningItems) {
      if (item && typeof item === "object" && item.type === "reasoning") input.push(item);
    }

    const content = this.toInputContent(message.content);
    if (content.length > 0) {
      input.push({ type: "message", role: "assistant", content });
    }

    const functionCallIds = message.additional_kwargs?.[FUNCTION_CALL_IDS_KEY];
    const mayReplayItemIds = reasoningItems.length > 0 && functionCallIds && typeof functionCallIds === "object";
    for (const call of message.tool_calls ?? []) {
      const callId = call.id;
      if (!callId) throw new Error(`OpenAI Responses tool call '${call.name}' missing id`);
      const itemId = mayReplayItemIds ? functionCallIds[callId] : undefined;
      input.push({
        type: "function_call",
        call_id: callId,
        name: call.name,
        arguments: JSON.stringify(call.args ?? {}),
        ...(typeof itemId === "string" && { id: itemId }),
      });
    }
  }

  private readonly isResponseOutputItem = (item: unknown): item is ResponseOutputItem => {
    return !!item && typeof item === "object" && typeof (item as { type?: unknown }).type === "string";
  };

  private toInputContent(content: ChatMessage["content"]): string | ResponseInputContent[] {
    if (typeof content === "string") return content;

    const result: ResponseInputContent[] = [];
    for (const part of content) {
      if (part.type === ContentPartType.Text && typeof part.text === "string") {
        if (part.text.length > 0) result.push({ type: "input_text", text: part.text });
      } else if (part.type === ContentPartType.Image && typeof part.data === "string") {
        const url = part.data.startsWith("data:")
          ? part.data
          : `data:${part.mimeType || "image/png"};base64,${part.data}`;
        result.push({ type: "input_image", detail: "auto", image_url: url });
      } else if (part.type === ContentPartType.ImageUrl && typeof part.image_url?.url === "string") {
        result.push({ type: "input_image", detail: "auto", image_url: part.image_url.url });
      }
    }
    return result;
  }

  private toolOutput(content: ChatMessage["content"]): string {
    if (typeof content === "string") return content || EMPTY_TOOL_OUTPUT;
    const text = content
      .filter(part => part.type === ContentPartType.Text && typeof part.text === "string")
      .map(part => (part as { text: string }).text)
      .join("\n\n");
    return text || EMPTY_TOOL_OUTPUT;
  }

  private toChatMessage(response: Response): ChatMessage {
    const final = this.toFinalMessage(response.id, "", response.output);
    return {
      ...final,
      ...(final.additional_kwargs || {}),
      additional_kwargs: {
        ...(final.additional_kwargs ?? {}),
        ...(response.incomplete_details?.reason && { stop_reason: response.incomplete_details.reason }),
      },
      ...(response.usage && {
        usage: {
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
          total_tokens: response.usage.total_tokens,
        },
      }),
    };
  }

  private toFinalMessage(
    responseId: string | undefined,
    pendingText: string,
    outputItems: ResponseOutputItem[],
  ): ChatMessage {
    const toolCalls: ChatToolCall[] = [];
    const text: string[] = [];
    for (const item of outputItems) {
      if (item.type === "function_call") {
        toolCalls.push({
          id: item.call_id,
          name: item.name,
          args: this.tryParseToolArguments(item.arguments),
          type: "tool_call",
        });
      } else if (item.type === "message") {
        for (const part of item.content) {
          if (part.type === "output_text") text.push(part.text);
          else if (part.type === "refusal") text.push(part.refusal);
        }
      }
    }

    // 完整响应时 pendingText 为空（文本都在 items 里）；流中断兜底时为尚未落为
    // 完整 item 的增量文本，追加在末尾以尽量保持原始顺序。
    const content = [...text, pendingText].join("");
    return {
      role: MessageRole.AI,
      content,
      ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
      ...(responseId && { id: responseId }),
      additional_kwargs: {
        [RESPONSE_OUTPUT_KEY]: outputItems,
      },
    };
  }

  private toStreamingMessage(
    responseId: string | undefined,
    outputText: string,
    calls: Map<number, ResponseFunctionToolCall>,
  ): ChatMessage {
    const toolCalls: ChatToolCall[] = [...calls.values()].map(call => ({
      id: call.call_id,
      name: call.name,
      args: this.tryParseToolArguments(call.arguments),
      type: "tool_call",
    }));
    return {
      role: MessageRole.AI,
      content: outputText,
      ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
      ...(responseId && { id: responseId }),
    };
  }
}
