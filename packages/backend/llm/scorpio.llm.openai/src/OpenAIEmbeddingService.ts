import OpenAI from "openai";
import type { EmbeddingConfig, IEmbeddingService } from "scorpio.llm";

export class OpenAIEmbeddingService implements IEmbeddingService {
  private client?: OpenAI;
  constructor(private readonly config: EmbeddingConfig) {}

  initialize(): void {
    if (!this.config.apiKey) throw new Error("Embedding config missing apiKey");
    this.client = new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseURL,
    });
  }

  async cleanup(): Promise<void> { this.client = undefined; }
  async embedQuery(text: string): Promise<number[]> { return (await this.embedDocuments([text]))[0]; }

  async embedDocuments(documents: string[]): Promise<number[][]> {
    if (documents.length === 0) return [];
    this.assertInitialized();

    const { dimensions } = this.config.config ?? {};
    const response = await this.client!.embeddings.create({
      model: this.config.model,
      input: documents,
      ...(dimensions != null && { dimensions }),
    });
    return [...response.data].sort((a, b) => a.index - b.index).map(d => d.embedding);
  }

  private assertInitialized(): void {
    if (!this.client) throw new Error(`${this.constructor.name} is not initialized`);
  }
}
