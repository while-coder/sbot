import type { ChatRequest, ChatResponse, Message, Options, Tool } from "ollama";
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
import { OllamaServiceBase } from "./OllamaServiceBase";

const EMPTY_TOOL_OUTPUT = "(empty tool output)";

/**
 * Ollama Chat 原生实现。
 *
 * 结构化输出优先用 Ollama 原生 JSON Schema（format 传 schema，需服务端 ≥ 0.5），
 * 失败时退化为 format:"json" + 指令注入 schema，兼容老版本服务端。
 */
export class OllamaModelService extends OllamaServiceBase implements IModelService {
  private tools: Tool[] = [];

  override async dispose(): Promise<void> {
    await super.dispose();
    this.tools = [];
  }

  bindTools(tools: any[]): void {
    this.assertInitialized();
    this.tools = tools.map(tool => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description || undefined,
        parameters: toJsonSchema(tool.schema) as Tool["function"]["parameters"],
      },
    }));
  }

  async invoke(prompt: string | ChatMessage[], options?: ModelInvokeOptions): Promise<ChatMessage> {
    const response = await this.withAbort(
      this.client!.chat(this.createRequest(prompt)),
      options?.signal,
    );
    return this.toChatMessage(response);
  }

  async stream(prompt: string | ChatMessage[], options?: ModelInvokeOptions): Promise<AsyncIterable<ChatMessage>> {
    const stream = await this.client!.chat({ ...this.createRequest(prompt), stream: true });
    if (options?.signal) {
      options.signal.throwIfAborted();
      options.signal.addEventListener("abort", () => stream.abort(), { once: true });
    }
    return this.accumulateStream(stream);
  }

  async invokeStructured<T = any>(
    schema: any,
    prompt: string | ChatMessage[],
    options?: StructuredInvokeOptions,
  ): Promise<T> {
    const jsonSchema = toJsonSchema(schema);
    try {
      const response = await this.withAbort(
        this.client!.chat({ ...this.createRequest(prompt), format: jsonSchema }),
        options?.signal,
      );
      return this.parseStructuredOutput<T>(response.message.content ?? "");
    } catch (error) {
      if (options?.signal?.aborted) throw error;
      // 老版本服务端不支持 schema format，退化为 json + 指令注入
      const response = await this.client!.chat({
        ...this.createRequest(withJsonModeInstruction(prompt, jsonSchema)),
        format: "json",
      });
      return this.parseStructuredOutput<T>(response.message.content ?? "");
    }
  }

  /**
   * 参数级默认值（temperature / num_predict）由 models.dev 目录补全：
   * temperature=false 的模型发送该参数会被拒；
   * maxTokens 未配置时取目录 maxOutputTokens，避免默认值偏小易截断。
   */
  private createRequest(prompt: string | ChatMessage[]): Omit<ChatRequest, "stream"> {
    const options = this.modelOptions();
    return {
      model: this.config.model,
      messages: this.toRequestMessages(prompt),
      ...(this.tools.length > 0 && { tools: this.tools }),
      ...(options && { options }),
    };
  }

  private modelOptions(): Partial<Options> | undefined {
    const info = this.getLLMInfo();
    const maxOutputTokens = this.config.maxTokens ?? (info.fromCatalog ? info.maxOutputTokens : undefined);
    const options: Partial<Options> = {
      ...(info.temperature !== false && this.config.temperature != null && { temperature: this.config.temperature }),
      ...(maxOutputTokens != null && { num_predict: maxOutputTokens }),
    };
    return Object.keys(options).length > 0 ? options : undefined;
  }

  private toRequestMessages(prompt: string | ChatMessage[]): Message[] {
    if (typeof prompt === "string") return [{ role: "user", content: prompt }];

    const messages: Message[] = [];
    for (const message of prompt) {
      if (message.role === MessageRole.Tool) {
        messages.push({
          role: "tool",
          content: this.textContent(message.content) || EMPTY_TOOL_OUTPUT,
          ...(message.name && { tool_name: message.name }),
        });
      } else if (message.role === MessageRole.AI) {
        messages.push({
          role: "assistant",
          content: this.textContent(message.content),
          ...(message.tool_calls?.length && {
            tool_calls: message.tool_calls.map(call => ({
              function: { name: call.name, arguments: call.args ?? {} },
            })),
          }),
        });
      } else {
        const { text, images } = this.toContentParts(message.content);
        messages.push({
          role: message.role === MessageRole.System ? "system" : "user",
          content: text,
          ...(images.length > 0 && { images }),
        });
      }
    }
    return messages;
  }

  private textContent(content: ChatMessage["content"]): string {
    return this.toContentParts(content).text;
  }

  /** Ollama 消息 content 为纯文本，图片走独立 images 字段（base64，不带 data: 前缀）。 */
  private toContentParts(content: ChatMessage["content"]): { text: string; images: string[] } {
    if (typeof content === "string") return { text: content, images: [] };
    if (!Array.isArray(content)) return { text: "", images: [] };

    const texts: string[] = [];
    const images: string[] = [];
    for (const part of content) {
      if (part?.type === ContentPartType.Text && typeof part.text === "string") {
        texts.push(part.text);
      } else if (part?.type === ContentPartType.Image && typeof part.data === "string") {
        images.push(this.toBase64Image(part.data));
      } else if (part?.type === ContentPartType.ImageUrl && typeof part.image_url?.url === "string") {
        const url = part.image_url.url;
        if (url.startsWith("data:")) images.push(this.toBase64Image(url));
        // 远程图片 URL 需下载转 base64，此处忽略
      }
    }
    return { text: texts.join("\n\n"), images };
  }

  private toBase64Image(data: string): string {
    const commaIndex = data.indexOf(",");
    return data.startsWith("data:") && commaIndex >= 0 ? data.slice(commaIndex + 1) : data;
  }

  private toChatMessage(response: ChatResponse): ChatMessage {
    const message = response.message ?? { role: "assistant", content: "" };
    const toolCalls: ChatToolCall[] = (message.tool_calls ?? []).map(call => ({
      name: call.function.name,
      args: call.function.arguments ?? {},
      type: "tool_call",
    }));
    const additionalKwargs = {
      ...(response.done_reason && { finish_reason: response.done_reason }),
      ...(message.thinking && { thinking: message.thinking }),
    };
    const usage = this.toUsage(response);
    return {
      role: MessageRole.AI,
      content: message.content ?? "",
      ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
      ...(Object.keys(additionalKwargs).length > 0 && { additional_kwargs: additionalKwargs }),
      ...(usage && { usage }),
    };
  }

  /** Ollama 流式 tool_calls 一次性完整到达，直接追加；用量与 done_reason 只在末包出现。 */
  private async *accumulateStream(stream: AsyncIterable<ChatResponse>): AsyncIterable<ChatMessage> {
    let content = "";
    const toolCalls: ChatToolCall[] = [];
    let finishReason: string | undefined;
    let usage: ReturnType<OllamaModelService["toUsage"]>;

    for await (const chunk of stream) {
      const message = chunk.message;
      if (typeof message?.content === "string") content += message.content;
      for (const call of message?.tool_calls ?? []) {
        toolCalls.push({ name: call.function.name, args: call.function.arguments ?? {}, type: "tool_call" });
      }
      if (chunk.done) {
        if (chunk.done_reason) finishReason = chunk.done_reason;
        usage ??= this.toUsage(chunk);
      }
      const additionalKwargs = {
        ...(finishReason && { finish_reason: finishReason }),
        ...(message?.thinking && { thinking: message.thinking }),
      };
      yield {
        role: MessageRole.AI,
        content,
        ...(toolCalls.length > 0 && { tool_calls: toolCalls.map(call => ({ ...call })) }),
        ...(Object.keys(additionalKwargs).length > 0 && { additional_kwargs: { ...additionalKwargs } }),
        ...(usage && { usage: { ...usage } }),
      };
    }
  }
}
