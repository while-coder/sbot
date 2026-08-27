import { Ollama } from "ollama";
import type { EmbeddingConfig, IEmbeddingService } from "scorpio.llm";
import { DEFAULT_OLLAMA_BASE_URL } from "./OllamaServiceBase";

export class OllamaEmbeddingService implements IEmbeddingService {
  private client?: Ollama;
  constructor(private readonly config: EmbeddingConfig) {}

  initialize(): void {
    this.client = new Ollama({ host: this.config.baseURL || DEFAULT_OLLAMA_BASE_URL });
  }

  async cleanup(): Promise<void> { this.client = undefined; }
  async embedQuery(text: string): Promise<number[]> { return (await this.embedDocuments([text]))[0]; }

  /** /api/embed 按输入顺序返回向量，无需再按 index 排序。 */
  async embedDocuments(documents: string[]): Promise<number[][]> {
    if (documents.length === 0) return [];
    this.assertInitialized();

    const { dimensions, keepAlive, truncate } = this.config.config ?? {};
    const response = await this.client!.embed({
      model: this.config.model,
      input: documents,
      ...(truncate != null && { truncate }),
      ...(keepAlive != null && { keep_alive: keepAlive }),
      ...(dimensions != null && { dimensions }),
    });
    return response.embeddings;
  }

  private assertInitialized(): void {
    if (!this.client) throw new Error(`${this.constructor.name} is not initialized`);
  }
}
