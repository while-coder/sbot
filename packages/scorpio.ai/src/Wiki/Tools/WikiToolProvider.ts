import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { IWikiService } from "../Service/IWikiService";

export class WikiToolProvider {

    static getTools(wikiServices: IWikiService[]): DynamicStructuredTool[] {
        if (wikiServices.length === 0) return [];
        return [
            WikiToolProvider.createSearchTool(wikiServices),
            WikiToolProvider.createCreateTool(wikiServices),
            WikiToolProvider.createReadTool(wikiServices),
        ];
    }

    private static createSearchTool(wikiServices: IWikiService[]): DynamicStructuredTool {
        return new DynamicStructuredTool({
            name: "wiki_search",
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
                    )).flat().sort((a, b) => b.score - a.score).slice(0, limit);

                    if (allResults.length === 0) {
                        return "No matching wiki pages found.";
                    }
                    const lines = allResults.map((r, i) => {
                        const tags = r.page.tags.length > 0 ? ` [${r.page.tags.join(", ")}]` : "";
                        const score = (r.score * 100).toFixed(1);
                        return `${i + 1}. **${r.page.title}**${tags}\n   Relevance: ${score}%\n   ${r.snippet}`;
                    });
                    return `Found ${allResults.length} result(s):\n\n${lines.join("\n\n")}`;
                } catch (e: any) {
                    return `Error searching wiki: ${e.message}`;
                }
            },
        });
    }

    private static createCreateTool(wikiServices: IWikiService[]): DynamicStructuredTool {
        return new DynamicStructuredTool({
            name: "wiki_create",
            description:
                "Create a new wiki page to persist knowledge for future reference.",
            schema: z.object({
                title: z.string().describe("Title of the new wiki page"),
                content: z.string().describe("Content of the wiki page"),
                tags: z.array(z.string()).optional().describe("Tags for categorization"),
            }),
            func: async ({ title, content, tags }) => {
                try {
                    const page = await wikiServices[0].createPage(title, content, tags);
                    return `Wiki page created successfully.\n\n- **ID:** ${page.id}\n- **Title:** ${page.title}\n- **Tags:** ${page.tags.length > 0 ? page.tags.join(", ") : "none"}`;
                } catch (e: any) {
                    return `Error creating wiki page: ${e.message}`;
                }
            },
        });
    }

    private static createReadTool(wikiServices: IWikiService[]): DynamicStructuredTool {
        return new DynamicStructuredTool({
            name: "wiki_read",
            description:
                "Read a wiki page by title or ID. Use title for human-friendly lookups.",
            schema: z.object({
                title: z.string().optional().describe("Page title to look up"),
                id: z.string().optional().describe("Page ID to look up"),
            }),
            func: async ({ title, id }) => {
                try {
                    if (!title && !id) {
                        return "Error: at least one of title or id must be provided.";
                    }

                    let page = null;
                    for (const wiki of wikiServices) {
                        if (title) page = await wiki.getPageByTitle(title);
                        if (!page && id) page = await wiki.getPage(id);
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
