import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { formatTimeAgo } from "../../Core";
import { IMemoryService } from "../Service/IMemoryService";

export const MEMORY_SEARCH_TOOL_NAME = 'memory_search' as const;

export class MemoryToolProvider {

    static getTools(memoryServices: IMemoryService[]): DynamicStructuredTool[] {
        if (memoryServices.length === 0) return [];
        return [
            MemoryToolProvider.createSearchTool(memoryServices),
        ];
    }

    private static createSearchTool(memoryServices: IMemoryService[]): DynamicStructuredTool {
        return new DynamicStructuredTool({
            name: MEMORY_SEARCH_TOOL_NAME,
            description:
                "Search long-term memory using semantic similarity. Use this to recall past conversations, user preferences, or previously learned facts.",
            schema: z.object({
                query: z.string().describe("The search query text"),
                limit: z.number().optional().default(5).describe("Maximum number of results to return"),
            }),
            func: async ({ query, limit }) => {
                try {
                    const perServiceLimit = Math.ceil(limit / memoryServices.length);
                    const allResults = (await Promise.all(
                        memoryServices.map(m => m.getMemories(query, perServiceLimit))
                    )).flat()
                      .sort((a, b) => b.score - a.score)
                      .slice(0, limit);

                    if (allResults.length === 0) {
                        return "No matching memories found.";
                    }

                    const lines = allResults.map((r, i) => {
                        const time = formatTimeAgo(r.memory.createdAt);
                        const score = (r.score * 100).toFixed(1);
                        return `${i + 1}. [${time}] ${r.memory.content} (relevance: ${score}%)`;
                    });
                    return `Found ${allResults.length} memory(s):\n\n${lines.join("\n")}`;
                } catch (e: any) {
                    return `Error searching memories: ${e.message}`;
                }
            },
        });
    }
}
