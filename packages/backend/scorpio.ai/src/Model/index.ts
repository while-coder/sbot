/**
 * 模型服务模块
 * 提供 LLM 模型服务接口和实现
 */

// ===== Provider 无关接口和公共基类 =====
export { IModelService, ModelProvider, ModelServiceBase, StructuredOutputMethod } from "scorpio.llm";
export type {
  ModelConfig,
  ModelInvokeOptions,
  StructuredInvokeOptions,
} from "scorpio.llm";

// ===== 工厂和配置 =====
export { ModelServiceFactory } from "./ModelServiceFactory";
export { RetryModelServiceProxy } from "./RetryModelServiceProxy";
