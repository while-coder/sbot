export enum EmbeddingProvider {
  OpenAI = "openai",
  Ollama = "ollama",
  Gemini = "gemini",
}

export interface EmbeddingConfig {
  provider: EmbeddingProvider | string;
  apiKey: string;
  baseURL?: string;
  model: string;
  /** Provider 私有参数，由对应 provider 的 configSchema 定义。 */
  config?: Record<string, any>;
}

export interface IEmbeddingService {
  embedQuery(text: string): Promise<number[]>;
  embedDocuments(documents: string[]): Promise<number[][]>;
  initialize(): void;
  cleanup(): Promise<void>;
}

export const IEmbeddingService = Symbol("IEmbeddingService");
