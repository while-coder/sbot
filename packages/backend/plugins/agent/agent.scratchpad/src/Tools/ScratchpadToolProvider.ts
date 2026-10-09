import { z } from "zod";
import { createAgentTool, type AgentTool } from "scorpio.ai";
import { SCRATCHPAD_PREVIEW_BYTES } from "../limits";
import { deleteEntry, listEntries, readEntries, writeEntry } from "../Storage/ScratchpadStore";

export const WRITE_SCRATCHPAD_TOOL_NAME = 'write_scratchpad' as const;
export const READ_SCRATCHPAD_TOOL_NAME = 'read_scratchpad' as const;
export const DELETE_SCRATCHPAD_TOOL_NAME = 'delete_scratchpad' as const;

/**
 * 会话黑板工具集：write / read / delete 三件套，root + channelSessionId 由插件按轮注入
 * （父子 agent 的 channelSessionId 同值，天然共享同一块板）。所有 func 返回纯字符串。
 */
export class ScratchpadToolProvider {
    static getTools(root: string, channelSessionId: number): AgentTool[] {
        return [
            ScratchpadToolProvider.createWriteTool(root, channelSessionId),
            ScratchpadToolProvider.createReadTool(root, channelSessionId),
            ScratchpadToolProvider.createDeleteTool(root, channelSessionId),
        ];
    }

    private static createWriteTool(root: string, channelSessionId: number): AgentTool {
        return createAgentTool({
            name: WRITE_SCRATCHPAD_TOOL_NAME,
            description: 'Store intermediate results of this collaboration on the shared scratchpad. ' +
                'The board is visible to you AND any sub-agents you dispatch (same conversation). ' +
                'Write results VERBATIM — readers use them as-is, without re-derivation. ' +
                'Long-term knowledge does NOT belong here; use memory for that. ' +
                'Same key overwrites (last write wins).',
            schema: z.object({
                key: z.string().trim().min(1).max(64)
                    .describe('Short slug for the entry, e.g. "research-findings" or "bug-location".'),
                content: z.string().trim().min(1)
                    .describe('The result, note or handoff information, stored verbatim.'),
            }),
            func: async ({ key, content }) => {
                const result = writeEntry(root, channelSessionId, key, content);
                if (!result.ok) return `Scratchpad write rejected: ${result.error}`;
                const bytes = Buffer.byteLength(content, 'utf8');
                return `Written "${key.trim()}" (${bytes} bytes, overwrote: ${result.overwrote ? 'yes' : 'no'})`;
            },
        });
    }

    private static createReadTool(root: string, channelSessionId: number): AgentTool {
        return createAgentTool({
            name: READ_SCRATCHPAD_TOOL_NAME,
            description: 'Read from the shared scratchpad. Without a key, lists all entries with previews. ' +
                'Entries are shared between you and your sub-agents (or the orchestrator that dispatched you).',
            schema: z.object({
                key: z.string().trim().optional()
                    .describe('Key of the entry to read. Omit to list everything on the board.'),
            }),
            func: async ({ key }) => {
                if (!key) return ScratchpadToolProvider.renderList(root, channelSessionId);
                const entries = readEntries(root, channelSessionId);
                const entry = entries[key.trim()];
                if (!entry) {
                    return `Not found: "${key.trim()}". Use read_scratchpad without a key to list entries.`;
                }
                return entry.content;
            },
        });
    }

    private static createDeleteTool(root: string, channelSessionId: number): AgentTool {
        return createAgentTool({
            name: DELETE_SCRATCHPAD_TOOL_NAME,
            description: 'Delete an entry from the shared scratchpad to keep the board small. ' +
                'Prefer overwriting the same key instead when the entry is an updated version.',
            schema: z.object({
                key: z.string().trim().min(1).describe('Key of the entry to delete.'),
            }),
            func: async ({ key }) => deleteEntry(root, channelSessionId, key),
        });
    }

    private static renderList(root: string, channelSessionId: number): string {
        const entries = readEntries(root, channelSessionId);
        const rows = listEntries(root, channelSessionId);
        if (rows.length === 0) {
            return 'The scratchpad is empty. Use write_scratchpad to put intermediate results on the board.';
        }
        const lines = [`${rows.length} scratchpad entr${rows.length === 1 ? 'y' : 'ies'}:`];
        for (const row of rows) {
            const preview = (entries[row.key]?.content ?? '').slice(0, SCRATCHPAD_PREVIEW_BYTES);
            const ellipsis = row.bytes > SCRATCHPAD_PREVIEW_BYTES ? '…' : '';
            lines.push(`- ${row.key} (${row.bytes} bytes): ${preview.replace(/\s+/g, ' ')}${ellipsis}`);
        }
        return lines.join('\n');
    }
}
