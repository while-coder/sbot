import { GoogleGenAI } from "@google/genai";
import type { EmbeddingConfig, IEmbeddingService } from "scorpio.llm";

/** 与 LangChain 实现一致：单次请求的文档数上限，超出分批并发。 */
const MAX_BATCH_SIZE = 100;

export class GoogleEmbeddingService implements IEmbeddingService {
  private client?: GoogleGenAI;
  constructor(private readonly config: EmbeddingConfig) {}

  initialize(): void {
    if (!this.config.apiKey) throw new Error("Embedding config missing apiKey");
    const { taskType, title } = this.config.config ?? {};
    if (title && taskType !== "RETRIEVAL_DOCUMENT") {
      throw new Error("title can only be specified with TaskType.RETRIEVAL_DOCUMENT");
    }
    this.client = new GoogleGenAI({
      apiKey: this.config.apiKey,
      httpOptions: { ...(this.config.baseURL && { baseUrl: this.config.baseURL }) },
    });
  }

  async cleanup(): Promise<void> { this.client = undefined; }

  async embedQuery(text: string): Promise<number[]> {
    this.assertInitialized();
    const response = await this.client!.models.embedContent({
      model: this.modelName,
      contents: this.normalize(text),
      config: this.embedConfig(),
    });
    return response.embeddings?.[0]?.values ?? [];
  }

  async embedDocuments(documents: string[]): Promise<number[][]> {
    if (documents.length === 0) return [];
    this.assertInitialized();

    const batches: string[][] = [];
    for (let i = 0; i < documents.length; i += MAX_BATCH_SIZE) {
      batches.push(documents.slice(i, i + MAX_BATCH_SIZE));
    }
    // 分批并发；失败批次的向量置空数组（与 LangChain 实现行为一致）
    const results = await Promise.allSettled(batches.map(batch =>
      this.client!.models.embedContent({
        model: this.modelName,
        contents: batch.map(doc => this.normalize(doc)),
        config: this.embedConfig(),
      }),
    ));
    return results.flatMap((result, index) => result.status === "fulfilled"
      ? (result.value.embeddings ?? []).map(embedding => embedding.values ?? [])
      : Array<number[]>(batches[index].length).fill([]));
  }

  private get modelName(): string {
    return (this.config.model || "text-embedding-004").replace(/^models\//, "");
  }

  private embedConfig(): { taskType?: string; title?: string } {
    const { taskType, title } = this.config.config ?? {};
    return { ...(taskType && { taskType }), ...(title && { title }) };
  }

  /** 与 LangChain 实现一致：换行替换为空格。 */
  private normalize(text: string): string {
    return text.replace(/\n/g, " ");
  }

  private assertInitialized(): void {
    if (!this.client) throw new Error(`${this.constructor.name} is not initialized`);
  }
}
