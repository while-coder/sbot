/**
 * 模型提供者枚举
 */
export enum ModelProvider {
  OpenAI          = "openai",
  OpenAIResponse  = "openai-response",
  Anthropic       = "anthropic",
  Ollama          = "ollama",
  Gemini          = "gemini",
}

/**
 * 模型配置接口
 */
export interface ModelConfig {
  provider?: ModelProvider | string;
  apiKey?: string;
  baseURL?: string;
  model?: string;
  apiVersion?: string;
  temperature?: number;
  maxTokens?: number;
}
