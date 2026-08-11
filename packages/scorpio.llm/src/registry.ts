import { EmbeddingProvider, type EmbeddingConfig, type IEmbeddingService } from "./embedding";
import { ModelProvider, type IModelService, type ModelConfig } from "./model";

export type ModelServiceFactory = (config: ModelConfig) => IModelService;
export type EmbeddingServiceFactory = (config: EmbeddingConfig) => IEmbeddingService;

export class LlmProviderRegistry {
  private readonly modelFactories = new Map<string, ModelServiceFactory>();
  private readonly embeddingFactories = new Map<string, EmbeddingServiceFactory>();

  registerModel(provider: string, factory: ModelServiceFactory): void {
    if (this.modelFactories.has(provider)) throw new Error(`Model provider already registered: ${provider}`);
    this.modelFactories.set(provider, factory);
  }

  registerEmbedding(provider: string, factory: EmbeddingServiceFactory): void {
    if (this.embeddingFactories.has(provider)) throw new Error(`Embedding provider already registered: ${provider}`);
    this.embeddingFactories.set(provider, factory);
  }

  createModel(config: ModelConfig): IModelService {
    const factory = this.modelFactories.get(config.provider) ?? this.modelFactories.get(ModelProvider.OpenAI);
    if (!factory) throw new Error(`Model provider is not registered: ${config.provider}`);
    return factory(config);
  }

  createEmbedding(config: EmbeddingConfig): IEmbeddingService {
    const factory = this.embeddingFactories.get(config.provider) ?? this.embeddingFactories.get(EmbeddingProvider.OpenAI);
    if (!factory) throw new Error(`Embedding provider is not registered: ${config.provider}`);
    return factory(config);
  }
}

export const llmProviderRegistry = new LlmProviderRegistry();
