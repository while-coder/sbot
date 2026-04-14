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
            WikiToolProvider.createUpdateTool(wikiServices),
            WikiToolProvider.createListTool(wikiServices),
            WikiToolProvider.createDeleteTool(wikiServices),
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

    private static createUpdateTool(wikiServices: IWikiService[]): DynamicStructuredTool {
        return new DynamicStructuredTool({
            name: "wiki_update",
            description:
                "Update an existing wiki page's content or tags.",
            schema: z.object({
                id: z.string().describe("ID of the page to update"),
                content: z.string().optional().describe("New content for the page"),
                tags: z.array(z.string()).optional().describe("New tags for the page"),
            }),
            func: async ({ id, content, tags }) => {
                try {
                    const updates: Record<string, any> = {};
                    if (content !== undefined) updates.content = content;
                    if (tags !== undefined) updates.tags = tags;

                    for (const wiki of wikiServices) {
                        const existing = await wiki.getPage(id);
                        if (existing) {
                            const page = await wiki.updatePage(id, updates);
                            return `Wiki page updated successfully.\n\n- **ID:** ${page.id}\n- **Title:** ${page.title}\n- **Version:** ${page.version}`;
                        }
                    }
                    return `Error updating wiki page: page not found (ID: ${id})`;
                } catch (e: any) {
                    return `Error updating wiki page: ${e.message}`;
                }
            },
        });
    }

    private static createListTool(wikiServices: IWikiService[]): DynamicStructuredTool {
        return new DynamicStructuredTool({
            name: "wiki_list",
            description:
                "List wiki pages, optionally filtered by tag.",
            schema: z.object({
                tag: z.string().optional().describe("Filter pages by this tag"),
                limit: z.number().optional().default(20).describe("Maximum number of pages to return"),
            }),
            func: async ({ tag, limit }) => {
                try {
                    let pages;
                    if (tag) {
                        pages = (await Promise.all(
                            wikiServices.map(s => s.searchByTag(tag, limit))
                        )).flat().slice(0, limit);
                    } else {
                        pages = (await Promise.all(
                            wikiServices.map(s => s.getAllPages())
                        )).flat().slice(0, limit);
                    }

                    if (pages.length === 0) {
                        return tag
                            ? `No wiki pages found with tag "${tag}".`
                            : "No wiki pages found.";
                    }

                    const lines = pages.map((p, i) => {
                        const tags = p.tags.length > 0 ? ` [${p.tags.join(", ")}]` : "";
                        return `${i + 1}. **${p.title}**${tags}`;
                    });
                    const header = tag
                        ? `Wiki pages tagged "${tag}" (${pages.length}):`
                        : `Wiki pages (${pages.length}):`;
                    return `${header}\n\n${lines.join("\n")}`;
                } catch (e: any) {
                    return `Error listing wiki pages: ${e.message}`;
                }
            },
        });
    }

    private static createDeleteTool(wikiServices: IWikiService[]): DynamicStructuredTool {
        return new DynamicStructuredTool({
            name: "wiki_delete",
            description:
                "Delete a wiki page by ID.",
            schema: z.object({
                id: z.string().describe("ID of the page to delete"),
            }),
            func: async ({ id }) => {
                try {
                    for (const wiki of wikiServices) {
                        const existing = await wiki.getPage(id);
                        if (existing) {
                            await wiki.deletePage(id);
                            return `Wiki page deleted successfully (ID: ${id}).`;
                        }
                    }
                    return `Error deleting wiki page: page not found (ID: ${id})`;
                } catch (e: any) {
                    return `Error deleting wiki page: ${e.message}`;
                }
            },
        });
    }
}
