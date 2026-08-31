import { z } from "zod";
import { createAgentTool, type AgentTool } from "scorpio.ai";
import { IWikiService } from "../Service/IWikiService";

export const WIKI_SEARCH_TOOL_NAME = 'wiki_search' as const;
export const WIKI_READ_TOOL_NAME = 'wiki_read' as const;

/** wiki_read 单次返回的最大字符数，超出用 offset 分页。 */
const WIKI_READ_MAX_CHARS = 20_000;

export interface WikiToolDescs {
    search: string;
    read: string;
}

export class WikiToolProvider {

    /**
     * 创建 Wiki 工具列表，描述从各 service 的 getToolDescs() 获取。
     * 多个 service 共用同一组工具，描述取自第一个 service。
     */
    static getTools(wikiServices: IWikiService[]): AgentTool[] {
        if (wikiServices.length === 0) return [];
        const descs = wikiServices[0].getToolDescs();
        return [
            WikiToolProvider.createSearchTool(wikiServices, descs.search),
            WikiToolProvider.createReadTool(wikiServices, descs.read),
        ];
    }

    private static createSearchTool(wikiServices: IWikiService[], description: string): AgentTool {
        return createAgentTool({
            name: WIKI_SEARCH_TOOL_NAME,
            description,
            schema: z.object({
                query: z.string().describe("The search query text"),
                limit: z.number().optional().default(5).describe("Maximum number of results to return"),
            }),
            func: async ({ query, limit }) => {
                try {
                    const groups = await Promise.all(
                        wikiServices.map(async s => {
                            const results = await s.search(query, limit);
                            if (results.length === 0) return null;
                            const lines = results.map(r => {
                                const tags = r.tags.length > 0 ? ` tags="${r.tags.join(', ')}"` : "";
                                return `  <page id="${r.id}" title="${r.title}"${tags} />`;
                            });
                            // wiki 身份在容器上声明一次，page 不重复携带
                            return `<wiki id="${s.getId()}">\n${lines.join("\n")}\n</wiki>`;
                        })
                    );
                    const out = groups.filter((g): g is string => g !== null).join("\n");
                    return out || "No matching wiki pages found.";
                } catch (e: any) {
                    return `Error searching wiki: ${e.message}`;
                }
            },
        });
    }

    private static createReadTool(wikiServices: IWikiService[], description: string): AgentTool {
        return createAgentTool({
            name: WIKI_READ_TOOL_NAME,
            description,
            schema: z.object({
                id: z.string().describe("Page ID"),
                wiki: z.string().optional()
                    .describe("Wiki ID the page belongs to (the wiki attribute from search results)"),
                offset: z.number().int().min(0).optional().default(0)
                    .describe("Character offset into the page content, for reading long pages in chunks"),
            }),
            func: async ({ id, wiki, offset }) => {
                try {
                    // wiki 参数收窄候选库；缺省时跨库收集命中，同 id 命中多库则报歧义而非静默读错
                    const candidates = wiki ? wikiServices.filter(s => s.getId() === wiki) : wikiServices;
                    if (candidates.length === 0) {
                        return `Wiki not found: ${wiki}`;
                    }

                    const matches: string[] = [];
                    for (const s of candidates) {
                        const content = await s.readContent(id);
                        if (content != null) matches.push(content);
                    }

                    if (matches.length === 0) {
                        return "Page not found.";
                    }
                    if (matches.length > 1) {
                        const wikis = candidates.map(s => s.getId()).join(', ');
                        return `Ambiguous page id "${id}" exists in multiple wikis (${wikis}); pass the wiki attribute.`;
                    }
                    const content = matches[0];

                    const total = content.length;
                    const start = offset;
                    const chunk = content.slice(start, start + WIKI_READ_MAX_CHARS);
                    let out = chunk;
                    if (start + chunk.length < total) {
                        out += `\n\n[Content truncated: showing characters ${start}-${start + chunk.length} of ${total}. Call again with offset=${start + chunk.length} to continue.]`;
                    }
                    return out;
                } catch (e: any) {
                    return `Error reading wiki page: ${e.message}`;
                }
            },
        });
    }
}
