import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { IWikiService } from "../Service/IWikiService";

export const WIKI_SEARCH_TOOL_NAME = 'wiki_search' as const;
export const WIKI_READ_TOOL_NAME = 'wiki_read' as const;

export interface WikiToolDescs {
    search: string;
    read: string;
}

export class WikiToolProvider {

    /**
     * 创建 Wiki 工具列表，描述从各 service 的 getToolDescs() 获取。
     * 多个 service 共用同一组工具，描述取自第一个 service。
     */
    static getTools(wikiServices: IWikiService[]): DynamicStructuredTool[] {
        if (wikiServices.length === 0) return [];
        const descs = wikiServices[0].getToolDescs();
        return [
            WikiToolProvider.createSearchTool(wikiServices, descs.search),
            WikiToolProvider.createReadTool(wikiServices, descs.read),
        ];
    }

    private static createSearchTool(wikiServices: IWikiService[], description: string): DynamicStructuredTool {
        return new DynamicStructuredTool({
            name: WIKI_SEARCH_TOOL_NAME,
            description,
            schema: z.object({
                query: z.string().describe("The search query text"),
                limit: z.number().optional().default(5).describe("Maximum number of results to return"),
            }),
            func: async ({ query, limit }) => {
                try {
                    const allResults = (await Promise.all(
                        wikiServices.map(s => s.search(query, limit))
                    )).flat().slice(0, limit);

                    if (allResults.length === 0) {
                        return "No matching wiki pages found.";
                    }
                    const lines = allResults.map(r => {
                        const tags = r.tags.length > 0 ? ` tags="${r.tags.join(', ')}"` : "";
                        return `<page id="${r.id}" title="${r.title}"${tags} />`;
                    });
                    return lines.join("\n");
                } catch (e: any) {
                    return `Error searching wiki: ${e.message}`;
                }
            },
        });
    }

    private static createReadTool(wikiServices: IWikiService[], description: string): DynamicStructuredTool {
        return new DynamicStructuredTool({
            name: WIKI_READ_TOOL_NAME,
            description,
            schema: z.object({
                id: z.string().describe("Page ID"),
            }),
            func: async ({ id }) => {
                try {
                    let page = null;
                    for (const wiki of wikiServices) {
                        page = await wiki.getPage(id);
                        if (page) break;
                    }

                    if (!page) {
                        return "Page not found.";
                    }

                    return `# ${page.title}\n\n${page.content}`;
                } catch (e: any) {
                    return `Error reading wiki page: ${e.message}`;
                }
            },
        });
    }
}
