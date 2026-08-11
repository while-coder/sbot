export enum EmbeddingProvider {
  OpenAI = "openai",
  Ollama = "ollama",
  Gemini = "gemini",
  VoyageAI = "voyageai",
  Cohere = "cohere",
}

export interface EmbeddingConfig {
  provider: EmbeddingProvider;
  apiKey: string;
  baseURL?: string;
  model: string;
}

export interface IEmbeddingService {
  embedQuery(text: string): Promise<number[]>;
  embedDocuments(documents: string[]): Promise<number[][]>;
  initialize(): void;
  cleanup(): Promise<void>;
}

export const IEmbeddingService = Symbol("IEmbeddingService");
