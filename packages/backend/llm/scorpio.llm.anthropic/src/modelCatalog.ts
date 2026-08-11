export interface AnthropicModelMeta {
  contextWindow: number;
  maxOutputTokens?: number;
}

export const ANTHROPIC_MODEL_CATALOG: Record<string, AnthropicModelMeta> = {
  "claude-opus-4-6":            { contextWindow: 200000, maxOutputTokens: 32000 },
  "claude-sonnet-4-6":          { contextWindow: 200000, maxOutputTokens: 64000 },
  "claude-haiku-4-5-20251001":  { contextWindow: 200000, maxOutputTokens: 8192 },
  "claude-sonnet-4-5-20250929": { contextWindow: 200000, maxOutputTokens: 64000 },
  "claude-opus-4-5-20251101":   { contextWindow: 200000, maxOutputTokens: 32000 },
  "claude-opus-4-1-20250805":   { contextWindow: 200000, maxOutputTokens: 32000 },
  "claude-sonnet-4-20250514":   { contextWindow: 200000, maxOutputTokens: 16000 },
  "claude-opus-4-20250514":     { contextWindow: 200000, maxOutputTokens: 32000 },
};
