import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import type { MCPPrompt, MCPPromptMessage, MCPResource, MCPResourceContent, MCPResourceTemplate } from "./MCPTypes";

export interface MCPServerCaps {
    prompts?: MCPPrompt[];
    resources?: MCPResource[];
    resourceTemplates?: MCPResourceTemplate[];
    getPrompt?: (name: string, args?: Record<string, string>) => Promise<MCPPromptMessage[]>;
    readResource?: (uri: string) => Promise<MCPResourceContent[]>;
}

export interface MCPUtilityToolDescs {
    prompts: string;
    resources: string;
}

export function createMCPUtilityTools(
    servers: Map<string, MCPServerCaps>,
    descs: MCPUtilityToolDescs,
): DynamicStructuredTool[] {
    const tools: DynamicStructuredTool[] = [];

    const hasPrompts = [...servers.values()].some(s => s.prompts?.length);
    const hasResources = [...servers.values()].some(s => s.resources?.length || s.resourceTemplates?.length);

    if (hasPrompts) {
        tools.push(new DynamicStructuredTool({
            name: "mcp_prompts",
            description: descs.prompts,
            schema: z.object({
                action: z.enum(["list", "get"]).describe("'list' to list prompts, 'get' to render a specific prompt"),
                name: z.string().optional().describe("Prompt name (required for 'get')"),
                arguments: z.record(z.string(), z.string()).optional().describe("Arguments to fill the prompt template (for 'get')"),
            }),
            func: async ({ action, name, arguments: args }) => {
                if (action === "list") {
                    const result: Record<string, MCPPrompt[]> = {};
                    for (const [sName, s] of servers) {
                        if (s.prompts?.length) result[sName] = s.prompts;
                    }
                    return JSON.stringify(result);
                }
                if (!name) return JSON.stringify({ error: "name is required for 'get'" });
                for (const [, entry] of servers) {
                    const hasPrompt = entry.prompts?.some((p: MCPPrompt) => p.name === name);
                    if (!hasPrompt || !entry.getPrompt) continue;
                    const messages = await entry.getPrompt(name, args);
                    return JSON.stringify({ messages });
                }
                return JSON.stringify({ error: `Prompt "${name}" not found in any server` });
            },
        }));
    }

    if (hasResources) {
        tools.push(new DynamicStructuredTool({
            name: "mcp_resources",
            description: descs.resources,
            schema: z.object({
                action: z.enum(["list", "read"]).describe("'list' to list resources, 'read' to fetch resource content"),
                uri: z.string().optional().describe("Resource URI (required for 'read')"),
            }),
            func: async ({ action, uri }) => {
                if (action === "list") {
                    const result: Record<string, { resources?: MCPResource[]; resourceTemplates?: MCPResourceTemplate[] }> = {};
                    for (const [sName, s] of servers) {
                        const entry: { resources?: MCPResource[]; resourceTemplates?: MCPResourceTemplate[] } = {};
                        if (s.resources?.length) entry.resources = s.resources;
                        if (s.resourceTemplates?.length) entry.resourceTemplates = s.resourceTemplates;
                        if (entry.resources || entry.resourceTemplates) result[sName] = entry;
                    }
                    return JSON.stringify(result);
                }
                if (!uri) return JSON.stringify({ error: "uri is required for 'read'" });
                for (const [, entry] of servers) {
                    const hasUri = entry.resources?.some((r: MCPResource) => r.uri === uri);
                    if (!hasUri) continue;
                    if (!entry.readResource) continue;
                    const contents = await entry.readResource(uri);
                    return JSON.stringify(contents);
                }
                for (const [, entry] of servers) {
                    if (!entry.readResource) continue;
                    try {
                        const contents = await entry.readResource(uri);
                        return JSON.stringify(contents);
                    } catch { continue; }
                }
                return JSON.stringify({ error: `Resource "${uri}" not found in any server` });
            },
        }));
    }

    return tools;
}
