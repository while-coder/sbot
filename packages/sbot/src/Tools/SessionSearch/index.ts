import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { createTextContent, createErrorResult, createSuccessResult, type MCPToolResult, type IAgentSaverService } from 'scorpio.ai';
import { loadPrompt } from '../../Core/PromptLoader';

export const SESSION_SEARCH_TOOL_NAME = 'session_search' as const;

const MAX_PREVIEW_LEN = 500;

export type SearchableSaver = IAgentSaverService & Required<Pick<IAgentSaverService, 'searchArchive'>>;

function extractContent(raw: unknown): string {
    if (raw == null) return '';
    if (typeof raw === 'string') return raw;
    if (!Array.isArray(raw)) return JSON.stringify(raw);

    const lines: string[] = [];
    for (const part of raw) {
        if (!part || typeof part !== 'object') continue;
        const p = part as any;
        switch (p.type) {
            case 'text':
                if (p.text) lines.push(p.text);
                break;
            case 'tool_use':
                lines.push(`[tool_call: ${p.name ?? 'unknown'}(${JSON.stringify(p.input ?? {})})]`);
                break;
            case 'tool_result':
                lines.push(`[tool_result: ${typeof p.content === 'string' ? p.content : JSON.stringify(p.content)}]`);
                break;
            case 'input_json_delta':
            case 'thinking':
                // streaming chunks / internal-only — skip
                break;
        }
    }
    return lines.join('\n');
}

export function createSessionSearchTool(saver: SearchableSaver | null): StructuredToolInterface {
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
            if (!saver) {
                return createErrorResult('Session search is not available: saver does not support full-text search.');
            }
            try {
                const results = await saver.searchArchive(query.all, limit ?? 20);
                if (results.length === 0) {
                    return createSuccessResult(createTextContent('No results found.'));
                }
                const formatted = results.map((r, i) => {
                    const time = r.createdAt ? new Date(r.createdAt * 1000).toISOString() : 'unknown';
                    const role = r.message.role ?? 'unknown';
                    const content = extractContent(r.message.content) || '(empty)';
                    const preview = content.length > MAX_PREVIEW_LEN ? content.slice(0, MAX_PREVIEW_LEN) + '…' : content;
                    return `### Result ${i + 1} · ${role} · ${time}\n\n${preview}`;
                }).join('\n\n---\n\n');
                return createSuccessResult(createTextContent(`Found ${results.length} results:\n\n${formatted}`));
            } catch (e: any) {
                return createErrorResult(`Search failed for query=${JSON.stringify(query)}: ${e.message}`);
            }
        },
    });
}
