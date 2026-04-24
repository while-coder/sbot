/**
 * Embedding 提供者枚举
 */
export enum EmbeddingProvider {
  OpenAI = "openai",
  Ollama = "ollama",
  Google = "google",
  VoyageAI = "voyageai",
  Cohere = "cohere",
}

/**
 * Embedding 配置接口
 */
export interface EmbeddingConfig {
  provider: EmbeddingProvider;
  apiKey: string;
  baseURL: string;
  model: string;
}
