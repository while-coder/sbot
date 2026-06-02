import { ModelProvider } from 'scorpio.ai';
import { config } from '../../Core/Config';
import { getModelMeta } from '../modelCatalog';

export class ModelInfoHelper {
    async fetchAndSaveContextWindow(modelId: string): Promise<void> {
        const mc = config.getModel(modelId);
        if (!mc?.model) return;
        let contextWindow: number | undefined;
        let maxOutputTokens: number | undefined;
        try {
            const base = (mc.baseURL || '').replace(/\/$/, '');
            if (mc.provider === ModelProvider.Anthropic) {
                const url = `${base}/v1/models/${encodeURIComponent(mc.model)}`;
                const headers: Record<string, string> = { 'x-api-key': mc.apiKey, 'anthropic-version': '2023-06-01' };
                const res = await fetch(url, { headers });
                if (res.ok) {
                    const data: any = await res.json();
                    contextWindow = data.context_window;
                    maxOutputTokens = data.max_tokens;
                }
            } else if (mc.provider === ModelProvider.Gemini || mc.provider === ModelProvider.GeminiImage) {
                const ver = mc.gemini?.apiVersion || 'v1beta';
                const url = `${base}/${ver}/models/${encodeURIComponent(mc.model)}`;
                const headers: Record<string, string> = { 'x-goog-api-key': mc.apiKey };
                const res = await fetch(url, { headers });
                if (res.ok) {
                    const data: any = await res.json();
                    contextWindow = data.inputTokenLimit;
                    maxOutputTokens = data.outputTokenLimit;
                }
            } else if (mc.provider === ModelProvider.Ollama) {
                const url = `${base}/api/show`;
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: mc.model }),
                });
                if (res.ok) {
                    const data: any = await res.json();
                    const info = data.model_info ?? {};
                    for (const key of Object.keys(info)) {
                        if (key.includes('context_length')) { contextWindow = info[key]; break; }
                    }
                }
            }
        } catch { /* ignore */ }
        if (contextWindow == null && maxOutputTokens == null) {
            const meta = getModelMeta(mc.provider, mc.model);
            if (meta) {
                contextWindow = meta.contextWindow;
                maxOutputTokens = meta.maxOutputTokens;
            }
        }
        if (contextWindow != null || maxOutputTokens != null) {
            const map = config.settings.models;
            if (map?.[modelId]) {
                if (contextWindow != null) map[modelId].contextWindow = contextWindow;
                if (maxOutputTokens != null && !map[modelId].maxTokens) map[modelId].maxTokens = maxOutputTokens;
                config.saveSettings();
            }
        }
    }
}

export const modelInfoHelper = new ModelInfoHelper();
