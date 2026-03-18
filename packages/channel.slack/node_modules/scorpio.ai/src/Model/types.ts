/**
 * 模型提供者枚举
 */
export enum ModelProvider {
  OpenAI    = "openai",
  Anthropic = "anthropic",
  Ollama    = "ollama",
}

/**
 * 模型配置接口
 */
export interface ModelConfig {
  provider?: ModelProvider | string;
  apiKey?: string;
  baseURL?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  // Azure OpenAI specific
  azureDeployment?: string;
  azureApiVersion?: string;
}
