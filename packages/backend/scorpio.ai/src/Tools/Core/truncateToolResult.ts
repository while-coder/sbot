import * as fs from 'fs/promises';
import * as path from 'path';
import { MCPContentType, type MCPContent, type MCPToolResult } from './mcp';
import { formatError } from '../../Core';

const MAX_CHARS = 32 * 1024;

export interface TruncateToolResultOptions {
    spillDir: string;
    toolCallId: string;
    toolName: string;
}

/**
 * 对单条 tool result 中的文本块做头部保留；完整文本写入 spillDir
 * 下的临时文件，并在正文后追加 read 工具风格的 Below + truncated 提示。
 *
 * - 仅处理 MCPContentType.Text 块；image/audio/document 块原样保留
 * - 单个 text 块字符数 ≤ MAX_CHARS 时不动
 * - 落盘失败时降级为不带路径的 Below 提示，保证主链路不中断
 */
export async function truncateMCPToolResult(
    result: MCPToolResult,
    opts: TruncateToolResultOptions,
): Promise<MCPToolResult> {
    const { toolName, toolCallId, spillDir } = opts;
    let touched = false;
    const newContent: MCPContent[] = [];
    let textBlockIdx = 0;

    for (const block of result.content) {
        if (block.type !== MCPContentType.Text) {
            newContent.push(block);
            continue;
        }
        // 防御：normalizeToMCPResult 在某些边界（比如 tool 返回 undefined）会把 text 写成非 string；
        // 这里直接跳过让外层逻辑去处理即可。
        if (typeof block.text !== 'string') {
            newContent.push(block);
            textBlockIdx++;
            continue;
        }
        const fullText = block.text;
        const chars = Array.from(fullText);
        const fullLen = chars.length;
        if (fullLen <= MAX_CHARS) {
            newContent.push(block);
            textBlockIdx++;
            continue;
        }

        const filename = `${sanitizeName(toolName)}-${sanitizeName(toolCallId)}-${textBlockIdx}.txt`;
        const filePath = path.join(spillDir, filename);
        let spillNote: string;
        try {
            await fs.writeFile(filePath, fullText, 'utf8');
            spillNote = `full file saved to: ${filePath}`;
        } catch (err: any) {
            spillNote = `spill failed: ${formatError(err)}`;
        }

        newContent.push({
            type: MCPContentType.Text,
            text: headWithMarker(chars, MAX_CHARS, spillNote),
        });
        touched = true;
        textBlockIdx++;
    }

    if (!touched) {
        return result;
    }
    return { ...result, content: newContent };
}

function headWithMarker(chars: string[], maxChars: number, note: string): string {
    const fullLen = chars.length;
    const head = Math.min(maxChars, fullLen);
    // 暴露字符区间，方便有 read 工具的 LLM 直接 mode="char" offset=head 回查缺失部分。
    const marker = `(Below: truncated chars (${head}-${fullLen}) not returned, ${note})`;

    return `${chars.slice(0, head).join('')}\n\n${marker}`;
}

function sanitizeName(s: string): string {
    return (s || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64);
}
