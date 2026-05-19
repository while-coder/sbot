import type { StructuredToolInterface } from "@langchain/core/tools";

export interface MCPPrompt {
    name: string;
    description?: string;
    arguments?: { name: string; description?: string; required?: boolean }[];
}

export interface MCPPromptMessage {
    role: "user" | "assistant";
    content: { type: string; text?: string; data?: string; mimeType?: string; resource?: { uri: string; mimeType?: string; text?: string } };
}

export interface MCPResource {
    uri: string;
    name: string;
    description?: string;
    mimeType?: string;
}

export interface MCPResourceTemplate {
    uriTemplate: string;
    name: string;
    description?: string;
    mimeType?: string;
}

export interface MCPResourceContent {
    uri: string;
    mimeType?: string;
    text?: string;
    blob?: string;
}

export interface ProviderResult {
    tools: StructuredToolInterface[];
    prompts?: MCPPrompt[];
    resources?: MCPResource[];
    resourceTemplates?: MCPResourceTemplate[];
    getPrompt?: (name: string, args?: Record<string, string>) => Promise<MCPPromptMessage[]>;
    readResource?: (uri: string) => Promise<MCPResourceContent[]>;
    close?: () => Promise<void>;
}

