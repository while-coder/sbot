import { singleton, inject, init, dispose } from "../../Core";
import { ImportanceEvaluator, ImportanceEvaluation } from "../ImportanceEvaluator";
import { LoggerService } from "../../LoggerService";

const logger = LoggerService.getLogger("ImportanceEvaluatorService.ts");

/**
 * 重要性评估服务配置
 */
export interface ImportanceEvaluatorConfig {
  apiKey: string;
  baseURL?: string;
  model?: string;
  enabled?: boolean;
}

/**
 * 重要性评估服务
 *
 * 使用 @singleton() 装饰器标记为单例服务，
 * 通过 @inject("ImportanceEvaluatorConfig") 注入配置。
 *
 * @example
 * ```ts
 * // 注册配置
 * container.registerInstance("ImportanceEvaluatorConfig", {
 *   apiKey: "xxx",
 *   baseURL: "https://api.openai.com",
 *   model: "gpt-3.5-turbo",
 *   enabled: true,
 * });
 *
 * // 解析服务（自动注入配置并初始化）
 * const service = await container.resolve(ImportanceEvaluatorService);
 * ```
 */
@singleton()
export class ImportanceEvaluatorService {
  private evaluator?: ImportanceEvaluator;

  constructor(
    @inject("ImportanceEvaluatorConfig") private config: ImportanceEvaluatorConfig
  ) {}

  @init()
  async initialize(): Promise<void> {
    if (this.config.enabled !== false) {
      this.evaluator = new ImportanceEvaluator({
        apiKey: this.config.apiKey,
        baseURL: this.config.baseURL,
        model: this.config.model || "gpt-3.5-turbo",
        enabled: true,
      });
      logger.info("重要性评估服务已初始化");
    } else {
      logger.info("重要性评估服务已禁用");
    }
  }

  @dispose()
  async cleanup(): Promise<void> {
    if (this.evaluator) {
      this.evaluator.disable();
      this.evaluator = undefined;
    }
    logger.info("重要性评估服务已释放");
  }

  /** 获取评估器实例 */
  getEvaluator(): ImportanceEvaluator | undefined {
    return this.evaluator;
  }

  /** 是否已启用 */
  isEnabled(): boolean {
    return this.evaluator !== undefined;
  }

  /** 评估单个记忆 */
  async evaluate(content: string, context?: string): Promise<ImportanceEvaluation | null> {
    if (!this.evaluator) {
      logger.warn("重要性评估服务未启用");
      return null;
    }
    return await this.evaluator.evaluate(content, context);
  }

  /** 批量评估 */
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
