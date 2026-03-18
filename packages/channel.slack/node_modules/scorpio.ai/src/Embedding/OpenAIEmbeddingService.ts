import { OpenAIEmbeddings } from "@langchain/openai";
import { IEmbeddingService } from "./IEmbeddingService";
import { EmbeddingConfig } from "./types";

/**
 * OpenAI Embedding 服务实现
 * 封装 @langchain/openai 的 OpenAIEmbeddings
 */
export class OpenAIEmbeddingService implements IEmbeddingService {
  private embeddings!: OpenAIEmbeddings;

  constructor(private config: EmbeddingConfig) {
    // interface 不需要 super() 调用
  }

  async initialize(): Promise<void> {
    if (!this.config.apiKey) {
      throw new Error("Embedding config missing apiKey");
    }

    this.embeddings = new OpenAIEmbeddings({
      modelName: this.config.model || "text-embedding-ada-002",
      openAIApiKey: this.config.apiKey,
      configuration: {
        baseURL: this.config.baseURL
      }
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
