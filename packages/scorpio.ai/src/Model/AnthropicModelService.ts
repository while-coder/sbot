import { ChatAnthropic } from "@langchain/anthropic";
import { createFunctionCallingParser } from "@langchain/core/language_models/structured_output";
import { AIMessageChunk, BaseMessage, SystemMessage } from "@langchain/core/messages";
import { toJsonSchema } from "@langchain/core/utils/json_schema";
import { IModelService } from "./IModelService";
import type { ModelInvokeOptions, StructuredInvokeOptions } from "./IModelService";
import { ModelConfig } from "./types";
import { type ChatMessage } from "../Saver/IAgentSaverService";
import { toChatMessage, toBaseMessages } from "../Saver/messageConverter";
import { getInvokeConfig, StructuredOutputMethod, toStructuredInput } from "./structuredOutput";

const enum CachePosition {
  First = 'first',
  Last = 'last',
}

/**
 * Anthropic 模型服务实现
 * 封装 @langchain/anthropic 的 ChatAnthropic（Claude 系列）
 */
export class AnthropicModelService implements IModelService {
  private model?: ChatAnthropic;
  private boundModel?: any;
  private cacheControl?: { type: "ephemeral" };

  constructor(public readonly config: ModelConfig) {
    if (config.anthropic?.promptCaching) {
      this.cacheControl = { type: "ephemeral" };
    }
  }

  initialize(): void {
    this.model = new ChatAnthropic({
      anthropicApiKey: this.config.apiKey,
      anthropicApiUrl: this.config.baseURL,
      model: this.config.model,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
      ...(this.config.anthropic?.thinking && { thinking: this.config.anthropic.thinking as any }),
    });
  }

  async dispose(): Promise<void> {
    this.model = undefined;
    this.boundModel = undefined;
  }

  async invoke(prompt: string | ChatMessage[], options?: ModelInvokeOptions): Promise<ChatMessage> {
    const m = this.boundModel ?? this.model!;
    const input = typeof prompt === 'string' ? prompt : this.applyCache(toBaseMessages(prompt));
    const result = await m.invoke(input, {
      ...(options?.signal && { signal: options.signal }),
    });
    return toChatMessage(result);
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
    if (method === StructuredOutputMethod.FunctionCalling) {
      return this.invokeStructuredToolStream<T>(schema, input, options);
    }

    const structured = this.model!.withStructuredOutput(schema, {
      method,
    });
    const stream = await structured.stream(input, getInvokeConfig(options));
    let result: T | undefined;
    for await (const chunk of stream) {
      result = chunk as T;
    }
    if (result === undefined) throw new Error("Anthropic structured output returned no result");
    return result;
  }

  private defaultStructuredMethod(): StructuredOutputMethod {
    return this.isThinkingEnabled()
      ? StructuredOutputMethod.JsonSchema
      : StructuredOutputMethod.FunctionCalling;
  }

  private async invokeStructuredToolStream<T = any>(schema: any, input: string | BaseMessage[], options?: StructuredInvokeOptions): Promise<T> {
    const isAnthropicTool = typeof schema?.name === 'string'
      && typeof schema?.description === 'string'
      && typeof schema?.input_schema === 'object'
      && schema.input_schema != null;
    const functionName = isAnthropicTool ? schema.name : 'extract';
    const jsonSchema = isAnthropicTool ? undefined : toJsonSchema(schema);
    const tool = isAnthropicTool
      ? {
          ...schema,
          ...(options?.strict !== undefined && { strict: options.strict }),
        }
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
      accumulated = accumulated
        ? accumulated.concat(chunk as AIMessageChunk)
        : (chunk as AIMessageChunk);
    }
    if (!accumulated) throw new Error("Anthropic structured output returned no result");
    if (!accumulated.tool_calls?.length) throw new Error("Anthropic structured output returned no tool call");

    const parser = createFunctionCallingParser(schema, functionName);
    return parser.invoke(accumulated, getInvokeConfig(options)) as Promise<T>;
  }

  private isThinkingEnabled(): boolean {
    const type = this.config.anthropic?.thinking?.type;
    return type === 'enabled' || type === 'adaptive';
  }

  async stream(messages: string | ChatMessage[], options?: ModelInvokeOptions): Promise<AsyncIterable<ChatMessage>> {
    const m = this.boundModel ?? this.model!;
    const input = typeof messages === 'string' ? messages : this.applyCache(toBaseMessages(messages));
    const lcStream = await m.stream(input, {
      ...(options?.signal && { signal: options.signal }),
    });
    return (async function* () {
      let accumulated: AIMessageChunk | undefined;
      for await (const chunk of lcStream) {
        accumulated = accumulated
          ? accumulated.concat(chunk as AIMessageChunk)
          : (chunk as AIMessageChunk);
        yield toChatMessage(accumulated);
      }
    })();
  }

  private applyCache(messages: BaseMessage[]): BaseMessage[] {
    if (!this.cacheControl || messages.length === 0) return messages;

    for (const msg of messages) {
      if (msg instanceof SystemMessage) {
        this.addCacheMarker(msg, CachePosition.First);
        break;
      }
    }

    return messages;
  }

  private addCacheMarker(message: BaseMessage, position = CachePosition.First): void {
    const content = message.content;
    if (typeof content === 'string') {
      message.content = [{ type: "text", text: content, cache_control: this.cacheControl }];
    } else if (Array.isArray(content) && content.length > 0) {
      const idx = position === CachePosition.Last ? content.length - 1 : 0;
      content[idx] = { ...content[idx], cache_control: this.cacheControl };
    }
  }
}
