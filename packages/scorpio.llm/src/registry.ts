import { EmbeddingProvider, type EmbeddingConfig, type IEmbeddingService } from "./embedding";
import { ModelProvider, type IModelService, type ModelConfig } from "./model";

export type ModelServiceFactory = (config: ModelConfig) => IModelService;
export type EmbeddingServiceFactory = (config: EmbeddingConfig) => IEmbeddingService;

export type LlmConfigFieldValue = string | number | boolean;

export interface LlmFieldCondition {
  field: string;
  eq?: LlmConfigFieldValue;
  ne?: LlmConfigFieldValue;
  in?: LlmConfigFieldValue[];
  notIn?: LlmConfigFieldValue[];
}

export type LlmShowWhen =
  | LlmFieldCondition
  | { and: LlmShowWhen[] }
  | { or: LlmShowWhen[] }
  | { not: LlmShowWhen };

export interface LlmConfigField {
  label: string;
  type: "string" | "textarea" | "password" | "boolean" | "number" | "select";
  required?: boolean;
  description?: string;
  default?: LlmConfigFieldValue;
  options?: Array<{ label: string; value: string }>;
  showWhen?: LlmShowWhen;
}

export interface ModelProviderDefaults {
  baseURL?: string;
  model?: string;
  config?: Record<string, any>;
}

export interface ModelProviderDefinition {
  type: string;
  label: string;
  configSchema: Record<string, LlmConfigField>;
  defaults?: ModelProviderDefaults;
  apiKeyEnabled?: boolean;
  apiKeyRequired?: boolean;
  createModel: ModelServiceFactory;
  listModels?: (config: ModelConfig) => Promise<string[]>;
}

export interface ModelProviderMetadata {
  type: string;
  label: string;
  configSchema: Record<string, LlmConfigField>;
  defaults?: ModelProviderDefaults;
  apiKeyEnabled?: boolean;
  apiKeyRequired?: boolean;
  supportsModelListing: boolean;
}

export class LlmProviderRegistry {
  private readonly modelProviders = new Map<string, ModelProviderDefinition>();
  private readonly embeddingFactories = new Map<string, EmbeddingServiceFactory>();

  registerModel(definition: ModelProviderDefinition): void {
    if (this.modelProviders.has(definition.type)) throw new Error(`Model provider already registered: ${definition.type}`);
    this.modelProviders.set(definition.type, definition);
  }

  registerEmbedding(provider: string, factory: EmbeddingServiceFactory): void {
    if (this.embeddingFactories.has(provider)) throw new Error(`Embedding provider already registered: ${provider}`);
    this.embeddingFactories.set(provider, factory);
  }

  createModel(config: ModelConfig): IModelService {
    const definition = this.modelProviders.get(config.provider) ?? this.modelProviders.get(ModelProvider.OpenAI);
    if (!definition) throw new Error(`Model provider is not registered: ${config.provider}`);
    return definition.createModel(config);
  }

  getModelProvider(provider: string): ModelProviderDefinition | undefined {
    return this.modelProviders.get(provider);
  }

  listModelProviders(): ModelProviderMetadata[] {
    return [...this.modelProviders.values()].map(definition => ({
      type: definition.type,
      label: definition.label,
      configSchema: definition.configSchema,
      defaults: definition.defaults,
      apiKeyEnabled: definition.apiKeyEnabled,
      apiKeyRequired: definition.apiKeyRequired,
      supportsModelListing: definition.listModels != null,
    }));
  }

  async listModels(config: ModelConfig): Promise<string[]> {
    const definition = this.modelProviders.get(config.provider);
    if (!definition) throw new Error(`Model provider is not registered: ${config.provider}`);
    if (!definition.listModels) return [];
    return definition.listModels(config);
  }

  createEmbedding(config: EmbeddingConfig): IEmbeddingService {
    const factory = this.embeddingFactories.get(config.provider) ?? this.embeddingFactories.get(EmbeddingProvider.OpenAI);
    if (!factory) throw new Error(`Embedding provider is not registered: ${config.provider}`);
    return factory(config);
  }
}

export const llmProviderRegistry = new LlmProviderRegistry();
