import { z } from "zod";
import { createAgentTool, type AgentTool } from "scorpio.ai";
import { TimeUtils } from "scorpio.ai";
import { INoteService } from "../Service/INoteService";

export const NOTE_SEARCH_TOOL_NAME = 'note_search' as const;

export interface NoteToolDescs {
    search: string;
}

export class NoteToolProvider {

    /**
     * 创建 Note 工具列表，描述从各 service 的 getToolDescs() 获取。
     * 多个 service 共用同一个搜索工具，描述取自第一个 service。
     */
    static getTools(noteServices: INoteService[]): AgentTool[] {
        if (noteServices.length === 0) return [];
        const descs = noteServices[0].getToolDescs();
        return [
            NoteToolProvider.createSearchTool(noteServices, descs.search),
        ];
    }

    private static createSearchTool(noteServices: INoteService[], description: string): AgentTool {
        return createAgentTool({
            name: NOTE_SEARCH_TOOL_NAME,
            description,
            schema: z.object({
                query: z.string().describe("The search query text"),
                limit: z.number().optional().default(5).describe("Maximum number of results to return"),
            }),
            func: async ({ query, limit }) => {
                try {
                    const perServiceLimit = Math.ceil(limit / noteServices.length);
                    const allResults = (await Promise.all(
                        noteServices.map(m => m.getNotes(query, perServiceLimit))
                    )).flat()
                      .sort((a, b) => b.score - a.score)
                      .slice(0, limit);

                    if (allResults.length === 0) {
                        return "No matching notes found.";
                    }

                    const lines = allResults.map((r, i) => {
                        const time = TimeUtils.formatTimeAgo(r.note.createdAt);
                        const score = (r.score * 100).toFixed(1);
                        return `${i + 1}. [${time}] ${r.note.content} (relevance: ${score}%)`;
                    });
                    return `Found ${allResults.length} note(s):\n\n${lines.join("\n")}`;
                } catch (e: any) {
                    return `Error searching notes: ${e.message}`;
                }
            },
        });
    }
}
