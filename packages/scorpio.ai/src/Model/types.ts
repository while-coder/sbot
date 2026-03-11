/**
 * 模型提供者枚举
 */
export enum ModelProvider {
  OpenAI = "openai",
}

/**
 * 模型配置接口
 */
export interface ModelConfig {
  provider?: ModelProvider;
  apiKey?: string;
  baseURL?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}
