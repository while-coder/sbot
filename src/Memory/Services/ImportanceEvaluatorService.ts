import { IService } from "../../Core/IService";
import { ImportanceEvaluator, ImportanceEvaluation } from "../ImportanceEvaluator";
import { LoggerService } from "../../LoggerService";

const logger = LoggerService.getLogger("ImportanceEvaluatorService.ts");

/**
 * 重要性评估服务配置
 */
export interface ImportanceEvaluatorServiceConfig {
  apiKey: string;
  baseURL?: string;
  model?: string;
  enabled?: boolean;
}

/**
 * 重要性评估服务
 * 将 ImportanceEvaluator 包装为可挂载的服务
 */
export class ImportanceEvaluatorService implements IService {
  readonly serviceName = "ImportanceEvaluatorService";
  isInitialized = false;

  private evaluator?: ImportanceEvaluator;
  private config: ImportanceEvaluatorServiceConfig;

  constructor(config: ImportanceEvaluatorServiceConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    if (this.config.enabled !== false) {
      this.evaluator = new ImportanceEvaluator({
        apiKey: this.config.apiKey,
        baseURL: this.config.baseURL,
        model: this.config.model || "gpt-3.5-turbo",
        enabled: true
      });

      logger.info("重要性评估服务已初始化");
    } else {
      logger.info("重要性评估服务已禁用");
    }

    this.isInitialized = true;
  }

  async dispose(): Promise<void> {
    if (this.evaluator) {
      this.evaluator.disable();
      this.evaluator = undefined;
    }
    this.isInitialized = false;
    logger.info("重要性评估服务已释放");
  }

  /**
   * 获取评估器实例
   */
  getEvaluator(): ImportanceEvaluator | undefined {
    return this.evaluator;
  }

  /**
   * 是否已启用
   */
  isEnabled(): boolean {
    return this.evaluator !== undefined;
  }

  /**
   * 评估单个记忆
   */
  async evaluate(content: string, context?: string): Promise<ImportanceEvaluation | null> {
    if (!this.evaluator) {
      logger.warn("重要性评估服务未启用");
      return null;
    }

    return await this.evaluator.evaluate(content, context);
  }

  /**
   * 批量评估
   */
  async evaluateBatch(
    items: Array<{ content: string; context?: string }>
  ): Promise<ImportanceEvaluation[]> {
    if (!this.evaluator) {
      logger.warn("重要性评估服务未启用");
      return [];
    }

    return await this.evaluator.evaluateBatch(items);
  }
}
