import { OllamaEmbeddings } from "@langchain/ollama";
import { IEmbeddingService } from "./IEmbeddingService";
import { EmbeddingConfig } from "./types";

/**
 * Ollama Embedding 服务实现
 * 封装 @langchain/ollama 的 OllamaEmbeddings，支持本地部署模型
 */
export class OllamaEmbeddingService implements IEmbeddingService {
  private embeddings!: OllamaEmbeddings;

  constructor(private config: EmbeddingConfig) {}

  async initialize(): Promise<void> {
    this.embeddings = new OllamaEmbeddings({
      baseUrl: this.config.baseURL ?? "http://localhost:11434",
      model: this.config.model,
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
