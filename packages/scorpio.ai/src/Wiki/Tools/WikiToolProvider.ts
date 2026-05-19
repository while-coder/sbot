import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { IWikiService } from "../Service/IWikiService";

export const WIKI_SEARCH_TOOL_NAME = 'wiki_search' as const;
export const WIKI_READ_TOOL_NAME = 'wiki_read' as const;

export class WikiToolProvider {

    static getTools(wikiServices: IWikiService[]): DynamicStructuredTool[] {
        if (wikiServices.length === 0) return [];
        return [
            WikiToolProvider.createSearchTool(wikiServices),
            WikiToolProvider.createReadTool(wikiServices),
        ];
    }

    private static createSearchTool(wikiServices: IWikiService[]): DynamicStructuredTool {
        return new DynamicStructuredTool({
            name: WIKI_SEARCH_TOOL_NAME,
            description:
                "Search the wiki knowledge base. Uses semantic similarity when available, falls back to text matching.",
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

    private static createReadTool(wikiServices: IWikiService[]): DynamicStructuredTool {
        return new DynamicStructuredTool({
            name: WIKI_READ_TOOL_NAME,
            description:
                "Read a wiki page by ID. Use wiki_search to find page IDs first.",
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
