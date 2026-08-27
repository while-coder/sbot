import { registerAnthropicProvider } from "scorpio.llm.anthropic";
import { registerGeminiProvider } from "scorpio.llm.gemini";
import { registerOllamaProvider } from "scorpio.llm.ollama";
import { registerOpenAIProvider } from "scorpio.llm.openai";

let registered = false;

/** 在应用组合入口显式注册内置 LLM Provider。 */
export function registerBuiltInLlmProviders(): void {
  if (registered) return;
  registerOpenAIProvider();
  registerAnthropicProvider();
  registerGeminiProvider();
  registerOllamaProvider();
  registered = true;
}
