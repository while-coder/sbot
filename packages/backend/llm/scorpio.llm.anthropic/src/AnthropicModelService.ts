import { ChatAnthropic } from "@langchain/anthropic";
import { createFunctionCallingParser } from "@langchain/core/language_models/structured_output";
import { AIMessageChunk, BaseMessage, SystemMessage } from "@langchain/core/messages";
import { toJsonSchema } from "@langchain/core/utils/json_schema";
import {
  type ChatMessage,
  type ModelConfig,
  type StructuredInvokeOptions,
  ModelServiceBase,
  StructuredOutputMethod,
  getInvokeConfig,
  toBaseMessages,
  toStructuredInput,
} from "scorpio.llm";

const enum CachePosition { First = "first", Last = "last" }

export class AnthropicModelService extends ModelServiceBase<ChatAnthropic> {
  private cacheControl?: { type: "ephemeral" };

  private get providerConfig(): Record<string, any> {
    return this.config.config ?? {};
  }

  private get thinking(): Record<string, any> | undefined {
    const type = this.providerConfig.thinkingType;
    if (!type || !this.supportsReasoning) return undefined;
    return {
      type,
      ...(type === "enabled" && this.providerConfig.thinkingBudget != null
        ? { budget_tokens: this.providerConfig.thinkingBudget }
        : {}),
    };
  }

  constructor(config: ModelConfig) {
    super(config);
    if (this.providerConfig.promptCaching) this.cacheControl = { type: "ephemeral" };
  }

  protected createModel(): ChatAnthropic {
    return new ChatAnthropic({
      anthropicApiKey: this.config.apiKey,
      anthropicApiUrl: this.config.baseURL,
      model: this.config.model,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
      ...(this.thinking && { thinking: this.thinking as any }),
    });
  }

  protected override prepareInput(input: string | ChatMessage[]): string | BaseMessage[] {
    return typeof input === "string" ? input : this.applyCache(toBaseMessages(input));
  }

  bindTools(tools: any[]): void {
    if (this.cacheControl && tools.length > 0) {
      const formatted = (this.model! as any).formatStructuredToolToAnthropic(tools);
      formatted[formatted.length - 1].cache_control = this.cacheControl;
      this.boundModel = (this.model! as any).withConfig({ tools: formatted });
    } else {
      this.boundModel = this.model!.bindTools(tools);
    }
  }

  async invokeStructured<T = any>(schema: any, prompt: string | ChatMessage[], options?: StructuredInvokeOptions): Promise<T> {
    const method = this.defaultStructuredMethod();
    const input = toStructuredInput(prompt, method, schema);
    if (method === StructuredOutputMethod.FunctionCalling) return this.invokeStructuredToolStream<T>(schema, input, options);

    const structured = this.model!.withStructuredOutput(schema, { method });
    const stream = await structured.stream(input, getInvokeConfig(options));
    let result: T | undefined;
    for await (const chunk of stream) result = chunk as T;
    if (result === undefined) throw new Error("Anthropic structured output returned no result");
    return result;
  }

  private defaultStructuredMethod(): StructuredOutputMethod {
    return this.isThinkingEnabled() ? StructuredOutputMethod.JsonSchema : StructuredOutputMethod.FunctionCalling;
  }

  private async invokeStructuredToolStream<T = any>(
    schema: any,
    input: string | BaseMessage[],
    options?: StructuredInvokeOptions,
  ): Promise<T> {
    const isAnthropicTool = typeof schema?.name === "string"
      && typeof schema?.description === "string"
      && typeof schema?.input_schema === "object"
      && schema.input_schema != null;
    const functionName = isAnthropicTool ? schema.name : "extract";
    const jsonSchema = isAnthropicTool ? undefined : toJsonSchema(schema);
    const tool = isAnthropicTool
      ? { ...schema, ...(options?.strict !== undefined && { strict: options.strict }) }
      : {
          name: functionName,
          description: jsonSchema?.description ?? "A function available to call.",
          input_schema: jsonSchema,
          ...(options?.strict !== undefined && { strict: options.strict }),
        };
    const model = this.model!.withConfig({
      outputVersion: "v0",
      tools: [tool],
      ...(!this.isThinkingEnabled() && { tool_choice: { type: "tool", name: functionName } }),
    });
    const stream = await model.stream(input, getInvokeConfig(options));
    let accumulated: AIMessageChunk | undefined;
    for await (const chunk of stream) {
      accumulated = accumulated ? accumulated.concat(chunk as AIMessageChunk) : (chunk as AIMessageChunk);
    }
    if (!accumulated) throw new Error("Anthropic structured output returned no result");
    if (!accumulated.tool_calls?.length) throw new Error("Anthropic structured output returned no tool call");
    return createFunctionCallingParser(schema, functionName).invoke(accumulated, getInvokeConfig(options)) as Promise<T>;
  }

  private isThinkingEnabled(): boolean {
    const type = this.thinking?.type;
    return type === "enabled" || type === "adaptive";
  }

  /**
   * 目录已明确标记不支持推理时，不向 Anthropic 兼容端发送 thinking 参数；
   * 目录未收录时保留用户的 Provider 设置，避免把自定义模型误判为不支持。
   */
  private get supportsReasoning(): boolean {
    if (this.config.llmInfo?.reasoning !== undefined) return this.config.llmInfo.reasoning;
    const info = this.getLLMInfo();
    return !info.fromCatalog || info.reasoning;
  }

  private applyCache(messages: BaseMessage[]): BaseMessage[] {
    if (!this.cacheControl || messages.length === 0) return messages;
    for (const message of messages) {
      if (message instanceof SystemMessage) {
        this.addCacheMarker(message, CachePosition.First);
        break;
      }
    }
    return messages;
  }

  private addCacheMarker(message: BaseMessage, position = CachePosition.First): void {
    const content = message.content;
    if (typeof content === "string") {
      message.content = [{ type: "text", text: content, cache_control: this.cacheControl }];
    } else if (Array.isArray(content) && content.length > 0) {
      const index = position === CachePosition.Last ? content.length - 1 : 0;
      content[index] = { ...content[index], cache_control: this.cacheControl };
    }
  }
}
