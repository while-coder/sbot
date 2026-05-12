import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { createTextContent, createErrorResult, createSuccessResult, type MCPToolResult, type IAgentSaverService, MessageRole } from 'scorpio.ai';
import { loadPrompt } from '../../Core/PromptLoader';

export const SESSION_SEARCH_TOOL_NAME = 'session_search' as const;

export function createSessionSearchTool(saver: IAgentSaverService): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: SESSION_SEARCH_TOOL_NAME,
        description: loadPrompt('tools/session_search/search.txt'),
        schema: z.object({
            query: z.string().describe('Search query (supports FTS5 syntax: AND, OR, NOT, phrase "...", prefix*)'),
            limit: z.number().optional().describe('Max results (default 20)'),
        }) as any,
        func: async ({ query, limit }: any): Promise<MCPToolResult> => {
            if (!saver.searchMessages) {
                return createErrorResult('Session search not available for this saver type');
            }
            try {
                const results = await saver.searchMessages(query, limit ?? 20);
                if (results.length === 0) {
                    return createSuccessResult(createTextContent('No results found.'));
                }
                const formatted = results.map((r, i) => {
                    const time = new Date((r.createdAt ?? 0) * 1000).toISOString();
                    const role = r.message.role ?? 'unknown';
                    const content = typeof r.message.content === 'string'
                        ? r.message.content
                        : JSON.stringify(r.message.content);
                    const preview = content.length > 500 ? content.slice(0, 500) + '...' : content;
                    return `<result index="${i + 1}" role="${role}" time="${time}">\n${preview}\n</result>`;
                }).join('\n');
                return createSuccessResult(createTextContent(`Found ${results.length} results:\n${formatted}`));
            } catch (e: any) {
                return createErrorResult(`Search failed: ${e.message}`);
            }
        },
    });
}
