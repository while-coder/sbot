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

export interface AnthropicConfig {
  thinking?: ThinkingConfig;
  promptCaching?: boolean;
}

export interface GeminiConfig {
  apiVersion?: string;
}

/**
 * 模型配置接口
 */
export interface ModelConfig {
  provider: ModelProvider;
  apiKey: string;
  baseURL: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  contextWindow?: number;
  anthropic?: AnthropicConfig;
  gemini?: GeminiConfig;
}
