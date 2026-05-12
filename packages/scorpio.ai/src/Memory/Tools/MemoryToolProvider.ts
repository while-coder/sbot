import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { formatTimeAgo } from "../../Core";
import { IMemoryService } from "../Service/IMemoryService";

export const MEMORY_SEARCH_TOOL_NAME = 'memory_search' as const;
export const MEMORY_ADD_TOOL_NAME = 'memory_add' as const;

export class MemoryToolProvider {

    static getTools(memoryServices: IMemoryService[]): DynamicStructuredTool[] {
        if (memoryServices.length === 0) return [];
        return [
            MemoryToolProvider.createSearchTool(memoryServices),
            MemoryToolProvider.createAddTool(memoryServices),
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
                      .sort((a, b) => b.decayedScore - a.decayedScore)
                      .slice(0, limit);

                    if (allResults.length === 0) {
                        return "No matching memories found.";
                    }

                    const lines = allResults.map((r, i) => {
                        const time = formatTimeAgo(r.memory.metadata.timestamp);
                        const score = (r.decayedScore * 100).toFixed(1);
                        return `${i + 1}. [${time}] ${r.memory.content} (relevance: ${score}%)`;
                    });
                    return `Found ${allResults.length} memory(s):\n\n${lines.join("\n")}`;
                } catch (e: any) {
                    return `Error searching memories: ${e.message}`;
                }
            },
        });
    }

    private static createAddTool(memoryServices: IMemoryService[]): DynamicStructuredTool {
        return new DynamicStructuredTool({
            name: MEMORY_ADD_TOOL_NAME,
            description:
                "Explicitly save an important piece of information to long-term memory for future recall. Use this for key facts, user preferences, or decisions worth remembering.",
            schema: z.object({
                content: z.string().describe("The memory content to save"),
                importance: z.number().optional().default(0.7).describe("Importance score from 0 to 1"),
            }),
            func: async ({ content, importance }) => {
                try {
                    const ids = await memoryServices[0].addMemoryDirect(content, {
                        autoSplit: false,
                        importance,
                    });
                    return `Memory saved successfully. (${ids.length} chunk(s), IDs: ${ids.join(", ")})`;
                } catch (e: any) {
                    return `Error saving memory: ${e.message}`;
                }
            },
        });
    }
}
