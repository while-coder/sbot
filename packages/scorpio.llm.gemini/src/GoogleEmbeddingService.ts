import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import type { EmbeddingConfig, IEmbeddingService } from "scorpio.llm";

export class GoogleEmbeddingService implements IEmbeddingService {
  private embeddings?: GoogleGenerativeAIEmbeddings;
  constructor(private readonly config: EmbeddingConfig) {}

  initialize(): void {
    if (!this.config.apiKey) throw new Error("Embedding config missing apiKey");
    this.embeddings = new GoogleGenerativeAIEmbeddings({
      ...(this.config.config ?? {}),
      modelName: this.config.model || "text-embedding-004",
      apiKey: this.config.apiKey,
      baseUrl: this.config.baseURL,
    });
  }

  async cleanup(): Promise<void> { this.embeddings = undefined; }
  async embedQuery(text: string): Promise<number[]> { return this.embeddings!.embedQuery(text); }
  async embedDocuments(documents: string[]): Promise<number[][]> { return this.embeddings!.embedDocuments(documents); }
}
