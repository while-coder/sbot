import { OpenAIEmbeddings } from "@langchain/openai";
import type { EmbeddingConfig, IEmbeddingService } from "scorpio.llm";

export class VoyageAIEmbeddingService implements IEmbeddingService {
  private embeddings?: OpenAIEmbeddings;
  constructor(private readonly config: EmbeddingConfig) {}

  initialize(): void {
    if (!this.config.apiKey) throw new Error("Embedding config missing apiKey");
    this.embeddings = new OpenAIEmbeddings({
      ...(this.config.config ?? {}),
      modelName: this.config.model || "voyage-3",
      openAIApiKey: this.config.apiKey,
      configuration: { baseURL: this.config.baseURL || "https://api.voyageai.com/v1" },
    });
  }

  async cleanup(): Promise<void> { this.embeddings = undefined; }
  async embedQuery(text: string): Promise<number[]> { return this.embeddings!.embedQuery(text); }
  async embedDocuments(documents: string[]): Promise<number[][]> { return this.embeddings!.embedDocuments(documents); }
}
