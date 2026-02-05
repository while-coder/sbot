import { IService } from "../../Core/IService";
import { MemoryCompressor, MergeStrategy, CompressionResult } from "../MemoryCompressor";
import { Memory } from "../types";
import { LoggerService } from "../../LoggerService";

const logger = LoggerService.getLogger("MemoryCompressorService.ts");

/**
 * 记忆压缩服务配置
 */
export interface MemoryCompressorServiceConfig {
  apiKey: string;
  baseURL?: string;
  model?: string;
  enabled?: boolean;
}

/**
 * 记忆压缩服务
 * 将 MemoryCompressor 包装为可挂载的服务
 */
export class MemoryCompressorService implements IService {
  readonly serviceName = "MemoryCompressorService";
  isInitialized = false;

  private compressor?: MemoryCompressor;
  private config: MemoryCompressorServiceConfig;

  constructor(config: MemoryCompressorServiceConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    if (this.config.enabled !== false) {
      this.compressor = new MemoryCompressor({
        apiKey: this.config.apiKey,
        baseURL: this.config.baseURL,
        model: this.config.model || "gpt-3.5-turbo",
        enabled: true
      });

      logger.info("记忆压缩服务已初始化");
    } else {
      logger.info("记忆压缩服务已禁用");
    }

    this.isInitialized = true;
  }

  async dispose(): Promise<void> {
    if (this.compressor) {
      this.compressor.disable();
      this.compressor = undefined;
    }
    this.isInitialized = false;
    logger.info("记忆压缩服务已释放");
  }

  /**
   * 获取压缩器实例
   */
  getCompressor(): MemoryCompressor | undefined {
    return this.compressor;
  }

  /**
   * 是否已启用
   */
  isEnabled(): boolean {
    return this.compressor !== undefined;
  }

  /**
   * 压缩记忆
   */
  async compress(
    memories: Memory[],
    strategy: MergeStrategy,
    generateEmbedding: (text: string) => Promise<number[]>
  ): Promise<CompressionResult | null> {
    if (!this.compressor) {
      logger.warn("记忆压缩服务未启用");
      return null;
    }

    return await this.compressor.compress(memories, strategy, generateEmbedding);
  }

  /**
   * 查找可压缩的记忆组
   */
  findCompressibleGroups(
    memories: Memory[],
    similarityThreshold: number = 0.8
  ): Memory[][] {
    if (!this.compressor) {
      logger.warn("记忆压缩服务未启用");
      return [];
    }

    return this.compressor.findCompressibleGroups(memories, similarityThreshold);
  }

  /**
   * 按时间窗口分组
   */
  groupByTimeWindow(
    memories: Memory[],
    timeWindowMs: number,
    minGroupSize: number = 3
  ): Memory[][] {
    if (!this.compressor) {
      logger.warn("记忆压缩服务未启用");
      return [];
    }

    return this.compressor.groupByTimeWindow(memories, timeWindowMs, minGroupSize);
  }
}
