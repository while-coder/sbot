import { OllamaEmbeddings } from "@langchain/ollama";
import type { EmbeddingConfig, IEmbeddingService } from "scorpio.llm";

export class OllamaEmbeddingService implements IEmbeddingService {
  private embeddings?: OllamaEmbeddings;
  constructor(private readonly config: EmbeddingConfig) {}

  initialize(): void {
    this.embeddings = new OllamaEmbeddings({
      ...(this.config.config ?? {}),
      baseUrl: this.config.baseURL ?? "http://localhost:11434",
      model: this.config.model,
    });
  }

  async cleanup(): Promise<void> { this.embeddings = undefined; }
  async embedQuery(text: string): Promise<number[]> { return this.embeddings!.embedQuery(text); }
  async embedDocuments(documents: string[]): Promise<number[][]> { return this.embeddings!.embedDocuments(documents); }
}
