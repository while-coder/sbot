import { GoogleGenAI, type GenerateContentResponseUsageMetadata } from "@google/genai";
import {
  ModelServiceBase,
  type ModelInvokeOptions,
  type TokenUsage,
} from "scorpio.llm";

/** Gemini 客户端与结构化输出解析的公共基座，供对话与图片两个实现共用。 */
export abstract class GeminiServiceBase extends ModelServiceBase {
  protected client?: GoogleGenAI;

  initialize(): void {
    if (!this.config.apiKey) throw new Error("Gemini config missing apiKey");
    this.client = new GoogleGenAI({
      apiKey: this.config.apiKey,
      httpOptions: {
        ...(this.config.baseURL && { baseUrl: this.config.baseURL }),
        apiVersion: this.config.config?.apiVersion ?? "v1",
      },
    });
    this.getLLMInfo();
  }

  override async dispose(): Promise<void> {
    this.client = undefined;
    await super.dispose();
  }

  protected assertInitialized(): void {
    if (!this.client) throw new Error(`${this.constructor.name} is not initialized`);
  }

  protected requestOptions(options?: ModelInvokeOptions): { abortSignal: AbortSignal } | undefined {
    return options?.signal ? { abortSignal: options.signal } : undefined;
  }

  protected toUsage(usage: GenerateContentResponseUsageMetadata): TokenUsage {
    return {
      input_tokens: usage.promptTokenCount ?? 0,
      output_tokens: usage.candidatesTokenCount ?? 0,
      total_tokens: usage.totalTokenCount ?? 0,
      ...(usage.cachedContentTokenCount != null && {
        cache_read_input_tokens: usage.cachedContentTokenCount,
      }),
    };
  }
}
