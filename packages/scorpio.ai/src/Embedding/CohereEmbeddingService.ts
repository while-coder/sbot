import { CohereEmbeddings } from "@langchain/cohere";
import { IEmbeddingService } from "./IEmbeddingService";
import { EmbeddingConfig } from "./types";

export class CohereEmbeddingService implements IEmbeddingService {
  private embeddings!: CohereEmbeddings;

  constructor(private config: EmbeddingConfig) {}

  async initialize(): Promise<void> {
    if (!this.config.apiKey) {
      throw new Error("Embedding config missing apiKey");
    }

    this.embeddings = new CohereEmbeddings({
      model: this.config.model || "embed-v4.0",
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
