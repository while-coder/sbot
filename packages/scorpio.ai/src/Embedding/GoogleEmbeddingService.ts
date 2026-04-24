import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { IEmbeddingService } from "./IEmbeddingService";
import { EmbeddingConfig } from "./types";

export class GoogleEmbeddingService implements IEmbeddingService {
  private embeddings!: GoogleGenerativeAIEmbeddings;

  constructor(private config: EmbeddingConfig) {}

  async initialize(): Promise<void> {
    if (!this.config.apiKey) {
      throw new Error("Embedding config missing apiKey");
    }

    this.embeddings = new GoogleGenerativeAIEmbeddings({
      modelName: this.config.model || "text-embedding-004",
      apiKey: this.config.apiKey,
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
