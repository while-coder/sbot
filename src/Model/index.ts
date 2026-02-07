/**
 * 模型服务模块
 */
export { IModelService, ModelInvokeResult } from "./IModelService";
export { OpenAIModelService } from "./OpenAIModelService";
export { ModelServiceFactory } from "./ModelServiceFactory";

export const MODEL_NAME = Symbol("MODEL_NAME");
