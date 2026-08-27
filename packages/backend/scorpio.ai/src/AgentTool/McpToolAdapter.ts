/**
 * MCP tool → AgentTool 包装器
 *
 * 用原生 @modelcontextprotocol/sdk 的 Client 替代 @langchain/mcp-adapters 的 loadMcpTools，
 * 输出形态保持与 mcp-adapters 一致（行为不变迁移）：
 *   - tool.invoke 返回：单条纯文本 → string；多内容 → ContentPart 数组
 *     （text → {type:"text"}，image → OpenAI 风格 {type:"image_url", image_url:{url: dataURL}}，
 *      audio → {type:"audio", data, mime_type}）
 *   - resource / resource_link 内容块按 mcp-adapters 默认 outputHandling 归入 artifact，
 *     而本项目的工具链只消费 content，故等价于丢弃
 *   - 服务端返回 isError:true 时抛错，由 Agent 侧统一转成 error ToolMessage
 *
 * 工具调用不直接持有底层 Client，而是经 callTool 回调路由到 RecoverableMcpClient，
 * 使每次调用透明地享受 stale-recovery。
 */

import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createAgentTool, type AgentTool, type ToolInvokeConfig } from "scorpio.llm";
import { prepareToolSchema } from "./McpSchema";

/** 底层工具调用入口（由 RecoverableMcpClient 提供，自带重连重试） */
export type McpCallToolFn = (
    name: string,
    args: Record<string, any>,
    options?: { timeout?: number; signal?: AbortSignal },
) => Promise<CallToolResult>;

/**
 * 拉取 server 的全量工具列表（跟随 nextCursor 分页）
 */
export async function listAllTools(client: Client): Promise<Tool[]> {
    const tools: Tool[] = [];
    let cursor: string | undefined;
    do {
        const response = await client.listTools(cursor ? { cursor } : undefined);
        tools.push(...(response.tools || []));
        cursor = response.nextCursor;
    } while (cursor);
    return tools;
}

/**
 * 把单个 MCP content 块转换为 ContentPart；resource 类内容返回 null（artifact 语义，丢弃）
 */
function convertContentBlock(content: any, toolName: string): any | null {
    switch (content.type) {
        case "text":
            return { type: "text", text: content.text };
        case "image":
            return { type: "image_url", image_url: { url: `data:${content.mimeType};base64,${content.data}` } };
        case "audio":
            // 与 mcp-adapters 输出形态保持一致（source_type/mime_type 字段名）
            return { type: "audio", source_type: "base64", data: content.data, mime_type: content.mimeType };
        case "resource":
        case "resource_link":
            return null;
        default:
            throw new Error(`MCP tool '${toolName}' returned a content block with unexpected type "${content.type}"`);
    }
}

/**
 * 把 callTool 的结果转换为与 mcp-adapters 相同的 invoke 返回值
 */
function convertCallToolResult(result: CallToolResult, toolName: string): string | any[] {
    if (!result || !Array.isArray(result.content)) {
        throw new Error(`MCP tool '${toolName}' returned an invalid result - expected an array of content`);
    }
    if (result.isError) {
        throw new Error(`MCP tool '${toolName}' returned an error: ${result.content.map(c => (c.type === "text" ? c.text : "")).join("\n")}`);
    }
    const converted = result.content
        .map(c => convertContentBlock(c, toolName))
        .filter((b): b is any => b !== null);
    // 单条纯文本直接返回 string，与 mcp-adapters 一致（normalizeToMCPResult 两种都接受）
    if (converted.length === 1 && converted[0].type === "text") return converted[0].text;
    return converted;
}

/** 从 ToolInvokeConfig 提取超时与取消信号 */
function extractCallOptions(config?: ToolInvokeConfig): { timeout?: number; signal?: AbortSignal } | undefined {
    if (!config?.signal) return undefined;
    return { signal: config.signal };
}

/**
 * 把 MCP server 的工具列表包装为 AgentTool
 */
export function wrapMcpTools(callTool: McpCallToolFn, mcpTools: Tool[]): AgentTool[] {
    return mcpTools.filter(tool => !!tool.name).map(tool => {
        return createAgentTool({
            name: tool.name,
            description: tool.description || "",
            schema: prepareToolSchema(tool.inputSchema as Record<string, any>),
            func: async (args: Record<string, any>, config?: ToolInvokeConfig) => {
                const result = await callTool(tool.name, args, extractCallOptions(config));
                return convertCallToolResult(result, tool.name);
            },
        });
    });
}
