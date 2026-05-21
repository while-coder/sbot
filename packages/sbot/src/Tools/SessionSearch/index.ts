import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { createTextContent, createErrorResult, createSuccessResult, type MCPToolResult, type IAgentSaverService } from 'scorpio.ai';
import { loadPrompt } from '../../Core/PromptLoader';

export const SESSION_SEARCH_TOOL_NAME = 'session_search' as const;

const MAX_PREVIEW_LEN = 500;

export type SearchableSaver = IAgentSaverService & Required<Pick<IAgentSaverService, 'searchMessages'>>;

export function createSessionSearchTool(saver: SearchableSaver): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: SESSION_SEARCH_TOOL_NAME,
        description: loadPrompt('tools/session_search/search.txt'),
        schema: z.object({
            query: z.object({
                all: z.array(
                    z.array(z.string().min(1)).min(1)
                ).min(1).describe('Array of OR-groups; all groups must match (AND). A single-term group is a 1-element array, e.g. [["error","fail"], ["deploy"]] means (error OR fail) AND deploy.'),
            }),
            limit: z.number().optional().describe('Max results (default 20)'),
        }) as any,
        func: async ({ query, limit }: any): Promise<MCPToolResult> => {
            try {
                const results = await saver.searchMessages(query.all, limit ?? 20);
                if (results.length === 0) {
                    return createSuccessResult(createTextContent('No results found.'));
                }
                const formatted = results.map((r, i) => {
                    const time = r.createdAt ? new Date(r.createdAt * 1000).toISOString() : 'unknown';
                    const role = r.message.role ?? 'unknown';
                    const raw = r.message.content;
                    const content = typeof raw === 'string'
                        ? raw
                        : Array.isArray(raw)
                            ? raw.filter((p: any) => p?.type === 'text').map((p: any) => p.text).join('\n')
                                || JSON.stringify(raw)
                            : JSON.stringify(raw);
                    const preview = content.length > MAX_PREVIEW_LEN ? content.slice(0, MAX_PREVIEW_LEN) + '...' : content;
                    return `<result index="${i + 1}" role="${role}" time="${time}">\n${preview}\n</result>`;
                }).join('\n');
                return createSuccessResult(createTextContent(`Found ${results.length} results:\n${formatted}`));
            } catch (e: any) {
                return createErrorResult(`Search failed for query=${JSON.stringify(query)}: ${e.message}`);
            }
        },
    });
}
