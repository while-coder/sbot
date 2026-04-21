import { ModelProvider } from 'scorpio.ai';

export interface ModelMeta {
    contextWindow: number;
    maxOutputTokens?: number;
}

export const MODEL_CATALOG: Record<string, Record<string, ModelMeta>> = {
    [ModelProvider.Anthropic]: {
        'claude-opus-4-6':            { contextWindow: 200000, maxOutputTokens: 32000 },
        'claude-sonnet-4-6':          { contextWindow: 200000, maxOutputTokens: 64000 },
        'claude-haiku-4-5-20251001':  { contextWindow: 200000, maxOutputTokens: 8192 },
        'claude-sonnet-4-5-20250929': { contextWindow: 200000, maxOutputTokens: 64000 },
        'claude-opus-4-5-20251101':   { contextWindow: 200000, maxOutputTokens: 32000 },
        'claude-opus-4-1-20250805':   { contextWindow: 200000, maxOutputTokens: 32000 },
        'claude-sonnet-4-20250514':   { contextWindow: 200000, maxOutputTokens: 16000 },
        'claude-opus-4-20250514':     { contextWindow: 200000, maxOutputTokens: 32000 },
    },
    [ModelProvider.Gemini]: {
        'gemini-3.1-pro-preview':       { contextWindow: 1048576, maxOutputTokens: 65536 },
        'gemini-3-flash-preview':       { contextWindow: 1048576, maxOutputTokens: 65536 },
        'gemini-3.1-flash-lite-preview': { contextWindow: 1048576, maxOutputTokens: 65536 },
        'gemini-2.5-pro':               { contextWindow: 1048576, maxOutputTokens: 65536 },
        'gemini-2.5-flash':             { contextWindow: 1048576, maxOutputTokens: 65536 },
        'gemini-2.5-flash-lite':        { contextWindow: 1048576, maxOutputTokens: 65536 },
        'gemini-2.0-flash':             { contextWindow: 1048576, maxOutputTokens: 8192 },
        'gemini-2.0-flash-lite':        { contextWindow: 1048576, maxOutputTokens: 8192 },
        'gemini-1.5-pro':               { contextWindow: 2097152, maxOutputTokens: 8192 },
        'gemini-1.5-flash':             { contextWindow: 1048576, maxOutputTokens: 8192 },
    },
    [ModelProvider.GeminiImage]: {
        'gemini-3.1-flash-image-preview': { contextWindow: 1048576, maxOutputTokens: 8192 },
        'gemini-3-pro-image-preview':     { contextWindow: 1048576, maxOutputTokens: 8192 },
        'gemini-2.5-flash-image':         { contextWindow: 1048576, maxOutputTokens: 8192 },
    },
};

export function getModelMeta(provider: string, model: string): ModelMeta | undefined {
    return MODEL_CATALOG[provider]?.[model];
}

export function getKnownModels(provider: string): string[] {
    const group = MODEL_CATALOG[provider];
    return group ? Object.keys(group) : [];
}
