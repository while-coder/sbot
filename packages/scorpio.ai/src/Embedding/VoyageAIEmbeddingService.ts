import { OpenAIEmbeddings } from "@langchain/openai";
import { IEmbeddingService } from "./IEmbeddingService";
import { EmbeddingConfig } from "./types";

// Voyage AI 提供 OpenAI 兼容的 embedding API
export class VoyageAIEmbeddingService implements IEmbeddingService {
  private embeddings!: OpenAIEmbeddings;

  constructor(private config: EmbeddingConfig) {}

  async initialize(): Promise<void> {
    if (!this.config.apiKey) {
      throw new Error("Embedding config missing apiKey");
    }

    this.embeddings = new OpenAIEmbeddings({
      modelName: this.config.model || "voyage-3",
      openAIApiKey: this.config.apiKey,
      configuration: {
        baseURL: this.config.baseURL || "https://api.voyageai.com/v1",
      },
    });
  }

  async cleanup(): Promise<void> {
    (this as any).embeddings = undefined;
  }

  async embedQuery(text: string): Promise<number[]> {
    return await this.embeddings.embedQuery(text);
  }

  async embedDocuments(documents: string[]): Promise<number[][]> {
    return await this.embeddings.embedDocuments(documents);
  }
}
