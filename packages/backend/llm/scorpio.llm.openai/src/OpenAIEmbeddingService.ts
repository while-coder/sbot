import { OpenAIEmbeddings } from "@langchain/openai";
import type { EmbeddingConfig, IEmbeddingService } from "scorpio.llm";

export class OpenAIEmbeddingService implements IEmbeddingService {
  private embeddings?: OpenAIEmbeddings;
  constructor(private readonly config: EmbeddingConfig) {}

  initialize(): void {
    if (!this.config.apiKey) throw new Error("Embedding config missing apiKey");
    this.embeddings = new OpenAIEmbeddings({
      ...(this.config.config ?? {}),
      modelName: this.config.model || "text-embedding-ada-002",
      openAIApiKey: this.config.apiKey,
      configuration: { baseURL: this.config.baseURL },
    });
  }

  async cleanup(): Promise<void> { this.embeddings = undefined; }
  async embedQuery(text: string): Promise<number[]> { return this.embeddings!.embedQuery(text); }
  async embedDocuments(documents: string[]): Promise<number[][]> { return this.embeddings!.embedDocuments(documents); }
}
