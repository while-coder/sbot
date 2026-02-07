/**
 * Embedding 服务抽象基类
 * 作为 DI 注入 token 使用（abstract class 可作为 token，interface 不行）
 */
export abstract class IEmbeddingService {
  /**
   * 为单个文本生成 embedding
   * @param text 输入文本
   * @returns embedding 向量
   */
  abstract embedQuery(text: string): Promise<number[]>;

  /**
   * 为多个文本批量生成 embeddings
   * @param texts 输入文本数组
   * @returns embeddings 向量数组
   */
  abstract embedDocuments(texts: string[]): Promise<number[][]>;

  /**
   * 初始化服务
   */
  abstract initialize(): Promise<void>;

  /**
   * 清理资源 — 释放实例占用的资源
   */
  abstract cleanup(): Promise<void>;
}
