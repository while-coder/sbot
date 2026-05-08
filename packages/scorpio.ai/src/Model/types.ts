/**
 * 模型提供者枚举
 */
export enum ModelProvider {
  OpenAI          = "openai",
  OpenAIResponse  = "openai-response",
  Anthropic       = "anthropic",
  Ollama          = "ollama",
  Gemini          = "gemini",
  GeminiImage     = "gemini-image",
}

export interface ThinkingConfig {
  type: "adaptive" | "enabled" | "disabled";
  budgetTokens?: number;
}

/**
 * 模型配置接口
 */
export interface ModelConfig {
  provider: ModelProvider;
  apiKey: string;
  baseURL: string;
  model: string;
  apiVersion?: string;
  temperature?: number;
  maxTokens?: number;
  contextWindow?: number;
  thinking?: ThinkingConfig;
}
