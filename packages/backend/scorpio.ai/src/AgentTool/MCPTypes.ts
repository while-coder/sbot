import type { AgentTool } from "scorpio.llm";

export interface ProviderResult {
    tools: AgentTool[];
    close?: () => Promise<void>;
}

