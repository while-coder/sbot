import { Ollama } from "ollama";
import type { ChatResponse } from "ollama";
import { ModelServiceBase, type TokenUsage } from "scorpio.llm";

export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";

/** Ollama 客户端与结构化输出解析的公共基座，供模型 / 嵌入两个实现共用。 */
export abstract class OllamaServiceBase extends ModelServiceBase {
  protected client?: Ollama;

  initialize(): void {
    this.client = new Ollama({
      host: this.config.baseURL || DEFAULT_OLLAMA_BASE_URL,
      // Ollama 默认无鉴权；新版服务端启用 API key 时透传 Bearer
      ...(this.config.apiKey && { headers: { Authorization: `Bearer ${this.config.apiKey}` } }),
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

  /**
   * ollama SDK 不接受 AbortSignal，用竞转实现取消：
   * resolve 后移除监听，避免累积监听器。
   */
  protected async withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return promise;
    signal.throwIfAborted();
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(signal.reason ?? new Error("Request aborted"));
      signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      return await Promise.race([promise, aborted]);
    } finally {
      if (onAbort) signal.removeEventListener("abort", onAbort);
    }
  }

  /** prompt_eval_count 在命中缓存时可能缺失，两个字段全空视为无用量。 */
  protected toUsage(response: Pick<ChatResponse, "prompt_eval_count" | "eval_count">): TokenUsage | undefined {
    if (response.prompt_eval_count == null && response.eval_count == null) return undefined;
    const input = response.prompt_eval_count ?? 0;
    const output = response.eval_count ?? 0;
    return { input_tokens: input, output_tokens: output, total_tokens: input + output };
  }
}
