import OpenAI from "openai";
import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionContentPart,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import {
  type ChatMessage,
  type ChatToolCall,
  type IModelService,
  type ModelInvokeOptions,
  type StructuredInvokeOptions,
  type TokenUsage,
  ContentPartType,
  MessageRole,
  StructuredOutputMethod,
  toJsonSchema,
  withJsonModeInstruction,
} from "scorpio.llm";
import { OpenAIServiceBase } from "./OpenAIServiceBase";

const EMPTY_TOOL_OUTPUT = "(empty tool output)";
const STRUCTURED_OUTPUT_TOOL = "structuredOutput";

/** 流式 tool_call 分片累加器。 */
interface ToolCallDelta {
  id?: string;
  name: string;
  arguments: string;
}

/**
 * OpenAI Chat Completions 原生实现。
 *
 * 流式自行累加 content / tool_calls，不经中间表示，
 * 网关返回的非标准 role 不影响聚合。
 */
export class OpenAIModelService extends OpenAIServiceBase implements IModelService {
  private tools: ChatCompletionTool[] = [];

  override async dispose(): Promise<void> {
    await super.dispose();
    this.tools = [];
  }

  bindTools(tools: any[]): void {
    this.assertInitialized();
    this.tools = tools.map(tool => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description || undefined,
        parameters: toJsonSchema(tool.schema) as Record<string, unknown>,
      },
    }));
  }

  async invoke(prompt: string | ChatMessage[], options?: ModelInvokeOptions): Promise<ChatMessage> {
    const response = await this.completions.create(this.createParams(prompt), this.requestOptions(options));
    return this.toChatMessage(response);
  }

  async stream(prompt: string | ChatMessage[], options?: ModelInvokeOptions): Promise<AsyncIterable<ChatMessage>> {
    const stream = await this.completions.create(
      { ...this.createParams(prompt), stream: true, stream_options: { include_usage: true } },
      this.requestOptions(options),
    );
    return this.accumulateStream(stream);
  }

  async invokeStructured<T = any>(
    schema: any,
    prompt: string | ChatMessage[],
    options?: StructuredInvokeOptions,
  ): Promise<T> {
    const method = this.defaultStructuredMethod();
    try {
      return await this.invokeStructuredWithMethod<T>(schema, prompt, method, options);
    } catch (error) {
      const fallbackMethod = this.getFallbackStructuredMethod(method);
      if (!fallbackMethod || !this.shouldFallbackStructured(options, error)) throw error;
      return this.invokeStructuredWithMethod<T>(schema, prompt, fallbackMethod, options);
    }
  }

  private get completions(): OpenAI["chat"]["completions"] {
    this.assertInitialized();
    return this.client!.chat.completions;
  }

  private createParams(prompt: string | ChatMessage[]): ChatCompletionCreateParamsNonStreaming {
    const params = this.modelDefaults(this.toRequestMessages(prompt));
    return this.tools.length > 0 ? { ...params, tools: this.tools } : params;
  }

  /**
   * 参数级默认值（temperature / maxTokens）由 models.dev 目录补全：
   * temperature=false 的模型（部分推理模型）发送该参数会被拒；
   * maxTokens 未配置时取目录 maxOutputTokens，避免默认值偏小易截断。
   */
  private modelDefaults(messages: ChatCompletionMessageParam[]): ChatCompletionCreateParamsNonStreaming {
    const info = this.getLLMInfo();
    const maxOutputTokens = this.config.maxTokens ?? (info.fromCatalog ? info.maxOutputTokens : undefined);
    return {
      model: this.config.model,
      messages,
      ...(info.temperature !== false && this.config.temperature != null && { temperature: this.config.temperature }),
      ...(maxOutputTokens != null && { max_tokens: maxOutputTokens }),
    };
  }

  private toRequestMessages(prompt: string | ChatMessage[]): ChatCompletionMessageParam[] {
    if (typeof prompt === "string") return [{ role: "user", content: prompt }];

    // 空内容对部分 API 直接 400：tool 消息换占位文本，其余无 tool_calls 的丢弃
    const messages: ChatCompletionMessageParam[] = [];
    for (const message of prompt) {
      const content = this.toRequestContent(message);
      if (message.role === MessageRole.Tool) {
        messages.push({ role: "tool", tool_call_id: message.tool_call_id ?? "", content: (content ?? EMPTY_TOOL_OUTPUT) as any });
      } else if (message.role === MessageRole.AI) {
        if (content != null || message.tool_calls?.length) {
          messages.push({
            role: "assistant",
            ...(content != null && { content: content as any }),
            ...(message.tool_calls?.length && {
              tool_calls: message.tool_calls.map(call => ({
                id: call.id ?? "",
                type: "function" as const,
                function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) },
              })),
            }),
          } as any);
        }
      } else if (content != null) {
        messages.push({ role: message.role === MessageRole.System ? "system" : "user", content: content as any });
      }
    }
    return messages;
  }

  private toRequestContent(message: ChatMessage): string | ChatCompletionContentPart[] | undefined {
    const content = message.content;
    if (typeof content === "string") return content || undefined;
    if (!Array.isArray(content)) return undefined;

    // 部分兼容网关的 tool 消息只接受纯字符串，纯文本 part 归一拼接
    if (message.role === MessageRole.Tool && content.every(part => part?.type === ContentPartType.Text && typeof part.text === "string")) {
      return content.map(part => (part as { text: string }).text).join("\n\n") || undefined;
    }

    const parts = content.map((part): ChatCompletionContentPart | undefined => {
      if (part?.type === ContentPartType.Text && typeof part.text === "string" && part.text.trim()) {
        return { type: "text" as const, text: part.text };
      }
      if (part?.type === ContentPartType.Image && typeof part.data === "string") {
        const url = part.data.startsWith("data:") ? part.data : `data:${part.mimeType || "image/png"};base64,${part.data}`;
        return { type: "image_url" as const, image_url: { url } };
      }
      if (part?.type === ContentPartType.ImageUrl && typeof part.image_url?.url === "string") {
        return { type: "image_url" as const, image_url: { url: part.image_url.url } };
      }
      return undefined;
    }).filter((part): part is ChatCompletionContentPart => part != null);
    return parts.length > 0 ? parts : undefined;
  }

  private toChatMessage(response: ChatCompletion): ChatMessage {
    const choice = response.choices?.[0];
    const message = choice?.message as any;
    const toolCalls: ChatToolCall[] = (message?.tool_calls ?? [])
      .filter((call: any) => call.type === "function")
      .map((call: any) => ({
        id: call.id,
        name: call.function.name,
        args: this.tryParseToolArguments(call.function.arguments ?? ""),
        type: "tool_call",
      }));
    return {
      role: MessageRole.AI,
      content: message?.content ?? "",
      ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
      id: response.id,
      ...(choice?.finish_reason && { additional_kwargs: { finish_reason: choice.finish_reason } }),
      ...(response.usage && { usage: this.toUsage(response.usage) }),
    };
  }

  private async *accumulateStream(stream: AsyncIterable<ChatCompletionChunk>): AsyncIterable<ChatMessage> {
    let content = "";
    const calls = new Map<number, ToolCallDelta>();
    let finishReason: string | undefined;
    let usage: TokenUsage | undefined;

    for await (const chunk of stream) {
      if (chunk.usage) usage = this.toUsage(chunk.usage);
      const choice = chunk.choices?.[0];
      if (choice) {
        const delta = choice.delta as any;
        if (typeof delta?.content === "string") content += delta.content;
        for (const call of delta?.tool_calls ?? []) {
          const acc = calls.get(call.index ?? 0) ?? { name: "", arguments: "" };
          if (call.id) acc.id = call.id;
          if (call.function?.name) acc.name = call.function.name;
          if (call.function?.arguments) acc.arguments += call.function.arguments;
          calls.set(call.index ?? 0, acc);
        }
        if (choice.finish_reason) finishReason = choice.finish_reason;
      }
      yield {
        role: MessageRole.AI,
        content,
        ...(calls.size > 0 && {
          tool_calls: [...calls.values()].map(acc => ({
            id: acc.id,
            name: acc.name,
            args: this.tryParseToolArguments(acc.arguments),
            type: "tool_call",
          })),
        }),
        ...(chunk.id && { id: chunk.id }),
        ...(finishReason && { additional_kwargs: { finish_reason: finishReason } }),
        ...(usage && { usage }),
      };
    }
  }

  private defaultStructuredMethod(): StructuredOutputMethod {
    const info = this.getLLMInfo();
    // 目录明确声明原生结构化输出时优先 JSON mode；否则官方 OpenAI 保留函数调用
    // 作为兼容性更好的默认路径，失败时自动切换。
    if (info.structuredOutput) return StructuredOutputMethod.JsonMode;
    const baseURL = (this.config.baseURL ?? "").toLowerCase();
    return info.toolCall && (!baseURL || baseURL.includes("api.openai.com"))
      ? StructuredOutputMethod.FunctionCalling
      : StructuredOutputMethod.JsonMode;
  }

  private getFallbackStructuredMethod(method: StructuredOutputMethod): StructuredOutputMethod | undefined {
    if (method === StructuredOutputMethod.FunctionCalling) return StructuredOutputMethod.JsonMode;
    if (method === StructuredOutputMethod.JsonMode) return StructuredOutputMethod.FunctionCalling;
    return undefined;
  }

  private invokeStructuredWithMethod<T = any>(
    schema: any,
    prompt: string | ChatMessage[],
    method: StructuredOutputMethod,
    options?: StructuredInvokeOptions,
  ): Promise<T> {
    return method === StructuredOutputMethod.JsonMode
      ? this.invokeJsonMode<T>(schema, prompt, options)
      : this.invokeFunctionCalling<T>(schema, prompt, options);
  }

  private async invokeFunctionCalling<T = any>(
    schema: any,
    prompt: string | ChatMessage[],
    options?: StructuredInvokeOptions,
  ): Promise<T> {
    const response = await this.completions.create({
      ...this.modelDefaults(this.toRequestMessages(prompt)),
      tools: [{
        type: "function" as const,
        function: {
          name: STRUCTURED_OUTPUT_TOOL,
          description: "Return a JSON object matching the provided schema.",
          parameters: toJsonSchema(schema) as Record<string, unknown>,
          ...(options?.strict !== undefined && { strict: options.strict }),
        },
      }],
      tool_choice: { type: "function" as const, function: { name: STRUCTURED_OUTPUT_TOOL } },
    }, this.requestOptions(options));
    const call = response.choices?.[0]?.message?.tool_calls?.[0];
    if (call?.type !== "function" || !call.function?.arguments) {
      throw new Error("OpenAI structured output returned no tool call");
    }
    return this.parseStructuredOutput<T>(call.function.arguments);
  }

  private async invokeJsonMode<T = any>(
    schema: any,
    prompt: string | ChatMessage[],
    options?: StructuredInvokeOptions,
  ): Promise<T> {
    const response = await this.completions.create({
      ...this.modelDefaults(this.toRequestMessages(withJsonModeInstruction(prompt, toJsonSchema(schema)))),
      response_format: { type: "json_object" as const },
    }, this.requestOptions(options));
    const content = response.choices?.[0]?.message?.content;
    return this.parseStructuredOutput<T>(typeof content === "string" ? content : JSON.stringify(content ?? ""));
  }
}
