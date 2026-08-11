import { CohereEmbeddings } from "@langchain/cohere";
import type { EmbeddingConfig, IEmbeddingService } from "scorpio.llm";

export class CohereEmbeddingService implements IEmbeddingService {
  private embeddings?: CohereEmbeddings;
  constructor(private readonly config: EmbeddingConfig) {}

  initialize(): void {
    if (!this.config.apiKey) throw new Error("Embedding config missing apiKey");
    this.embeddings = new CohereEmbeddings({
      model: this.config.model || "embed-v4.0",
      apiKey: this.config.apiKey,
    });
  }

  async cleanup(): Promise<void> { this.embeddings = undefined; }
  async embedQuery(text: string): Promise<number[]> { return this.embeddings!.embedQuery(text); }
  async embedDocuments(documents: string[]): Promise<number[][]> { return this.embeddings!.embedDocuments(documents); }
}
