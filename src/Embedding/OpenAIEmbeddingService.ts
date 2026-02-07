import { OpenAIEmbeddings } from "@langchain/openai";
import { IEmbeddingService } from "./IEmbeddingService";
import { EmbeddingConfig } from "../Config";

/**
 * OpenAI Embedding 服务实现
 * 封装 @langchain/openai 的 OpenAIEmbeddings
 */
export class OpenAIEmbeddingService extends IEmbeddingService {
  private embeddings!: OpenAIEmbeddings;

  constructor(private config: EmbeddingConfig) {
    super();
  }

  async initialize(): Promise<void> {
    if (!this.config.apiKey) {
      throw new Error("Embedding 配置缺少 apiKey");
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

  async embedDocuments(texts: string[]): Promise<number[][]> {
    return await this.embeddings.embedDocuments(texts);
  }
}
