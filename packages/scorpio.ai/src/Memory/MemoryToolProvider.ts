import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import type { IMemoryService } from "./IMemoryService";

export const READ_MEMORY_TOOL_NAME = 'read_memory' as const;
export const SEARCH_MEMORY_TOOL_NAME = 'search_memory' as const;

/**
 * 工厂方法集合：用 IMemoryService 生成 read_memory / search_memory 两个 tool。
 *
 * 设计：
 * - 工具描述从 service.getToolDescs() 取，允许将来按 profile 覆盖
 * - read_memory 命中失败时返回明确错误 + 引导 agent 转 search_memory
 * - search_memory 0 命中时返回明确文本（避免 agent 误以为没记忆系统）
 */
export class MemoryToolProvider {
    static getTools(service: IMemoryService): DynamicStructuredTool[] {
        const descs = service.getToolDescs();
        return [
            MemoryToolProvider.createReadTool(service, descs.read),
            MemoryToolProvider.createSearchTool(service, descs.search),
        ];
    }

    private static createReadTool(service: IMemoryService, description: string): DynamicStructuredTool {
        return new DynamicStructuredTool({
            name: READ_MEMORY_TOOL_NAME,
            description,
            schema: z.object({
                slug: z.string().describe("Slug of the memory entry. Pattern: lowercase-kebab, ≤64 chars."),
            }),
            func: async ({ slug }) => {
                try {
                    const row = await service.readMemory(slug);
                    if (!row) {
                        return [
                            `No memory found with slug "${slug}".`,
                            ``,
                            `Possible reasons:`,
                            `- The slug was misremembered or paraphrased — slugs are exact.`,
                            `- The entry was deleted or never created.`,
                            ``,
                            `Try search_memory with the keyword you're looking for instead.`,
                        ].join("\n");
                    }
                    // body 已经包含 # title H1
                    return row.body;
                } catch (e: any) {
                    return `Error reading memory: ${e.message}`;
                }
            },
        });
    }

    private static createSearchTool(service: IMemoryService, description: string): DynamicStructuredTool {
        return new DynamicStructuredTool({
            name: SEARCH_MEMORY_TOOL_NAME,
            description,
            schema: z.object({
                query: z.string().describe("Search query (BM25 over title + body)"),
                limit: z.number().optional().default(5).describe("Max results to return (default 5)"),
            }),
            func: async ({ query, limit }) => {
                try {
                    const hits = await service.search(query, limit);
                    if (hits.length === 0) {
                        return [
                            `No memory matches for "${query}".`,
                            ``,
                            `0 results does NOT mean it was never recorded. Consider:`,
                            `- Retry with FEWER / rarer terms (1-2 distinctive words beat a long phrase).`,
                            `- For literals the tokenizer splits (URLs, ports), search a single rare token.`,
                            `- Check the memory menu in the system prompt — exact slug match goes via read_memory.`,
                        ].join("\n");
                    }
                    const lines = [
                        `Found ${hits.length} match${hits.length === 1 ? "" : "es"} (BM25-ranked, best first).`,
                        `Use read_memory(slug) for full body if needed.`,
                        ``,
                    ];
                    for (const h of hits) {
                        lines.push(`### ${h.title}  (\`${h.slug}\`, kind=${h.kind}, score=${h.score.toFixed(3)})`);
                        lines.push(h.snippet);
                        lines.push("");
                    }
                    return lines.join("\n");
                } catch (e: any) {
                    return `Error searching memory: ${e.message}`;
                }
            },
        });
    }
}
