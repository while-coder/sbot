import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import type { IMemoryService } from "../Service/IMemoryService";
import { MemoryScope } from "../Storage/IMemoryStore";

export const READ_MEMORY_TOOL_NAME = 'read_memory' as const;
export const SEARCH_MEMORY_TOOL_NAME = 'search_memory' as const;
export const REMEMBER_MEMORY_TOOL_NAME = 'remember_memory' as const;
const REMEMBER_MEMORY_TOOL_DESCRIPTION = 'Queue a memory only when the user explicitly asks to remember/save it; ' +
    'a successful call only queues the write for background extraction — describe it as queued, not already stored. ' +
    'Pass only the durable content, without the surrounding "remember this" request. ' +
    'Use workspace for project-specific information and global for cross-project facts or preferences.';

/**
 * 工厂方法集合：用 IMemoryService 生成 read_memory / search_memory / remember_memory 工具。
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
            MemoryToolProvider.createRememberTool(service, REMEMBER_MEMORY_TOOL_DESCRIPTION),
            MemoryToolProvider.createReadTool(service, descs.read),
            MemoryToolProvider.createSearchTool(service, descs.search),
        ];
    }

    private static createRememberTool(
        service: IMemoryService,
        description: string,
    ): DynamicStructuredTool {
        return new DynamicStructuredTool({
            name: REMEMBER_MEMORY_TOOL_NAME,
            description,
            schema: z.object({
                scope: z.enum([MemoryScope.Global, MemoryScope.Workspace])
                    .describe('Where the memory must be stored. Use workspace for project-specific information.'),
                content: z.string().trim().min(1).max(8000)
                    .describe('The durable fact, preference, workflow, or decision to remember; omit the save request itself.'),
            }),
            func: async ({ scope, content }) => {
                const pendingId = await service.remember(content, scope);
                return `Memory write queued: pending=${pendingId}, scope=${scope}`;
            },
        });
    }

    private static createReadTool(service: IMemoryService, description: string): DynamicStructuredTool {
        return new DynamicStructuredTool({
            name: READ_MEMORY_TOOL_NAME,
            description,
            schema: z.object({
                slug: z.string().describe("Slug of the memory entry. Pattern: lowercase-kebab, ≤64 chars."),
                scope: z.enum([MemoryScope.Global, MemoryScope.Workspace])
                    .describe("Required scope shown in the memory menu/search result."),
            }),
            func: async ({ slug, scope }) => {
                try {
                    const row = await service.readMemory(slug, scope);
                    if (!row) {
                        return `Memory not found: [${scope}] ${slug}. Use search_memory to find the exact slug and scope.`;
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
                query: z.string().trim().min(1)
                    .describe("Search query (BM25 over the markdown body, whose first line is the entry's title)"),
                limit: z.number().int().min(1).max(10).optional().default(5)
                    .describe("Max results to return (1-10, default 5)"),
            }),
            func: async ({ query, limit }) => {
                try {
                    const hits = await service.search(query, limit);
                    if (hits.length === 0) {
                        return `No memory matched "${query}". Retry with 1-2 distinctive terms or one literal token.`;
                    }
                    // 每条的头行与 system prompt 里注入的 memory menu 完全同形——
                    // 同一条记忆在两处长得一样，
                    // agent 不需要靠 slug 反推"这就是菜单里那条"。
                    // 不输出 score：见 MemorySearchHit.score 的注释。
                    const lines = [`${hits.length} memory match${hits.length === 1 ? "" : "es"}:`, ``];
                    for (const [index, h] of hits.entries()) {
                        if (index > 0) lines.push("");
                        lines.push(`- [${h.scope}; ${h.kind}; evidence=${h.evidenceCount}] \`${h.slug}\` — ${h.title}`);
                        // snippet 可能多行，整体缩进挂在头行下面，避免与下一条混在一起
                        const snippet = MemoryToolProvider.cleanSnippet(h.snippet, h.title);
                        if (snippet) {
                            for (const line of snippet.split("\n")) lines.push(`  ${line}`);
                        }
                    }
                    return lines.join("\n");
                } catch (e: any) {
                    return `Error searching memory: ${e.message}`;
                }
            },
        });
    }

    /** FTS snippet 命中标题时会重复输出正文已有的 H1；仅删除可确认相同的首行。 */
    private static cleanSnippet(snippet: string, title: string): string {
        const lines = snippet.trim().split(/\r?\n/);
        const firstLineTitle = lines[0]
            ?.replace(/<</g, '')
            .replace(/>>/g, '')
            .replace(/^#\s*/, '')
            .trim();
        if (firstLineTitle === title.trim()) {
            lines.shift();
            while (lines[0]?.trim() === '') lines.shift();
        }
        return lines.join('\n').trim();
    }
}
