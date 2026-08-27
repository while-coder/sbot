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

/** Provider 对 API key 的要求：不可配 / 可选 / 必填。 */
export enum ApiKeyMode {
  Disabled = "disabled",
  Enabled = "enabled",
  Required = "required",
}

export interface ModelProviderDefinition {
  type: string;
  label: string;
  configSchema: Record<string, LlmConfigField>;
  defaults?: ModelProviderDefaults;
  apiKeyMode: ApiKeyMode;
  createModel: ModelServiceFactory;
}

export interface ModelProviderMetadata {
  type: string;
  label: string;
  configSchema: Record<string, LlmConfigField>;
  defaults?: ModelProviderDefaults;
  apiKeyMode: ApiKeyMode;
}

export type EmbeddingProviderDefaults = ModelProviderDefaults;

export interface EmbeddingProviderDefinition {
  type: string;
  label: string;
  configSchema: Record<string, LlmConfigField>;
  defaults?: EmbeddingProviderDefaults;
  baseURLEnabled?: boolean;
  apiKeyMode: ApiKeyMode;
  createEmbedding: EmbeddingServiceFactory;
}

export interface EmbeddingProviderMetadata {
  type: string;
  label: string;
  configSchema: Record<string, LlmConfigField>;
  defaults?: EmbeddingProviderDefaults;
  baseURLEnabled?: boolean;
  apiKeyMode: ApiKeyMode;
}

export class LlmProviderRegistry {
  private readonly modelProviders = new Map<string, ModelProviderDefinition>();
  private readonly embeddingProviders = new Map<string, EmbeddingProviderDefinition>();

  registerModel(definition: ModelProviderDefinition): void {
    if (this.modelProviders.has(definition.type)) throw new Error(`Model provider already registered: ${definition.type}`);
    this.modelProviders.set(definition.type, definition);
  }

  registerEmbedding(definition: EmbeddingProviderDefinition): void {
    if (this.embeddingProviders.has(definition.type)) throw new Error(`Embedding provider already registered: ${definition.type}`);
    this.embeddingProviders.set(definition.type, definition);
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
      apiKeyMode: definition.apiKeyMode,
    }));
  }

  createEmbedding(config: EmbeddingConfig): IEmbeddingService {
    const definition = this.embeddingProviders.get(config.provider) ?? this.embeddingProviders.get(EmbeddingProvider.OpenAI);
    if (!definition) throw new Error(`Embedding provider is not registered: ${config.provider}`);
    return definition.createEmbedding(config);
  }

  getEmbeddingProvider(provider: string): EmbeddingProviderDefinition | undefined {
    return this.embeddingProviders.get(provider);
  }

  listEmbeddingProviders(): EmbeddingProviderMetadata[] {
    return [...this.embeddingProviders.values()].map(definition => ({
      type: definition.type,
      label: definition.label,
      configSchema: definition.configSchema,
      defaults: definition.defaults,
      baseURLEnabled: definition.baseURLEnabled,
      apiKeyMode: definition.apiKeyMode,
    }));
  }
}

export const llmProviderRegistry = new LlmProviderRegistry();
