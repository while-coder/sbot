import { ModelProvider } from 'scorpio.ai';
import { ANTHROPIC_MODEL_CATALOG } from 'scorpio.llm.anthropic';
import { GEMINI_IMAGE_MODEL_CATALOG, GEMINI_MODEL_CATALOG } from 'scorpio.llm.gemini';

export interface ModelMeta {
    contextWindow: number;
    maxOutputTokens?: number;
}

export const MODEL_CATALOG: Record<string, Record<string, ModelMeta>> = {
    [ModelProvider.Anthropic]: ANTHROPIC_MODEL_CATALOG,
    [ModelProvider.Gemini]: GEMINI_MODEL_CATALOG,
    [ModelProvider.GeminiImage]: GEMINI_IMAGE_MODEL_CATALOG,
};

export function getModelMeta(provider: string, model: string): ModelMeta | undefined {
    return MODEL_CATALOG[provider]?.[model];
}
