import { config } from "../Config";
import { Container } from "../Core";
import { IModelService } from "./IModelService";
import { OpenAIModelService } from "./OpenAIModelService";

/**
 * 模型服务模块
 */
export { IModelService, ModelInvokeResult } from "./IModelService";
export { OpenAIModelService } from "./OpenAIModelService";

export const MODEL_NAME = Symbol("MODEL_NAME");
export async function createModelService(container: Container): Promise<IModelService> {
    // 工厂函数可以从容器中解析其他依赖
    const modelName = await container.resolve<string>(MODEL_NAME);
    const modelConfig = config.getModel(modelName);
    if (!modelConfig) {
        throw new Error(`模型配置 "${String(modelName)}" 未找到`);
    }
    switch (modelConfig.provider) {
        case "openai":
            return new OpenAIModelService(modelConfig);
        default:
            throw new Error(`不支持的模型提供者: ${modelConfig.provider}`);
    }
}
