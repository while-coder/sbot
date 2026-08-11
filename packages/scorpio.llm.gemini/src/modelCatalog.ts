export interface GeminiModelMeta {
  contextWindow: number;
  maxOutputTokens?: number;
}

export const GEMINI_MODEL_CATALOG: Record<string, GeminiModelMeta> = {
  "gemini-3.1-pro-preview":        { contextWindow: 1048576, maxOutputTokens: 65536 },
  "gemini-3-flash-preview":        { contextWindow: 1048576, maxOutputTokens: 65536 },
  "gemini-3.1-flash-lite-preview": { contextWindow: 1048576, maxOutputTokens: 65536 },
  "gemini-2.5-pro":                { contextWindow: 1048576, maxOutputTokens: 65536 },
  "gemini-2.5-flash":              { contextWindow: 1048576, maxOutputTokens: 65536 },
  "gemini-2.5-flash-lite":         { contextWindow: 1048576, maxOutputTokens: 65536 },
  "gemini-2.0-flash":              { contextWindow: 1048576, maxOutputTokens: 8192 },
  "gemini-2.0-flash-lite":         { contextWindow: 1048576, maxOutputTokens: 8192 },
  "gemini-1.5-pro":                { contextWindow: 2097152, maxOutputTokens: 8192 },
  "gemini-1.5-flash":              { contextWindow: 1048576, maxOutputTokens: 8192 },
};

export const GEMINI_IMAGE_MODEL_CATALOG: Record<string, GeminiModelMeta> = {
  "gemini-3.1-flash-image-preview": { contextWindow: 1048576, maxOutputTokens: 8192 },
  "gemini-3-pro-image-preview":      { contextWindow: 1048576, maxOutputTokens: 8192 },
  "gemini-2.5-flash-image":          { contextWindow: 1048576, maxOutputTokens: 8192 },
};
