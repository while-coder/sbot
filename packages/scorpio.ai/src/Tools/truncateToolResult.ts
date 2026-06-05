import * as fs from 'fs/promises';
import * as path from 'path';
import { MCPContentType, type MCPContent, type MCPToolResult } from './types';

const MAX_CHARS = 32 * 1024;

export interface TruncateToolResultOptions {
    spillDir: string;
    toolCallId: string;
    toolName: string;
}

/**
 * 对单条 tool result 中的文本块做 head+tail 截断；超限部分整段写入 spillDir
 * 下的临时文件，截断标记中带上文件绝对路径，便于人工/工具回查。
 *
 * - 仅处理 MCPContentType.Text 块；image/audio/document 块原样保留
 * - 单个 text 块字符数 ≤ MAX_CHARS 时不动
 * - 落盘失败时降级为不带路径的截断，保证主链路不中断
 */
export async function truncateMCPToolResult(
    result: MCPToolResult,
    opts: TruncateToolResultOptions,
): Promise<MCPToolResult> {
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
        const allChars = Array.from(fullText);
        const fullLen = allChars.length;
        if (fullLen <= MAX_CHARS) {
            newContent.push(block);
            textBlockIdx++;
            continue;
        }

        const filename = `${sanitizeName(opts.toolName)}-${sanitizeName(opts.toolCallId)}-${textBlockIdx}.txt`;
        const filePath = path.join(opts.spillDir, filename);
        let spillNote: string;
        try {
            await fs.writeFile(filePath, fullText, 'utf8');
            spillNote = `full output saved to ${filePath}`;
        } catch (err: any) {
            spillNote = `spill failed: ${err?.message ?? err}`;
        }

        newContent.push({
            type: MCPContentType.Text,
            text: headTailWithMarker(allChars, fullLen, MAX_CHARS, spillNote),
        });
        touched = true;
        textBlockIdx++;
    }

    if (!touched) return result;
    return { ...result, content: newContent };
}

function headTailWithMarker(allChars: string[], fullLen: number, maxChars: number, note: string): string {
    // 上界估算：所有数字都用 fullLen 占位，实际 marker 一定 ≤ 这个长度（其他三个数都 ≤ fullLen）
    const markerEstimate = `\n\n…[truncated: chars ${fullLen}..${fullLen} of ${fullLen} omitted (${fullLen} chars); ${note}]…\n\n`;
    const markerLen = Array.from(markerEstimate).length;
    const budget = Math.max(0, maxChars - markerLen);
    const headBudget = Math.floor(budget / 2);
    const tailBudget = budget - headBudget;

    const head = allChars.slice(0, headBudget).join('');
    const tail = allChars.slice(fullLen - tailBudget).join('');
    const omitted = fullLen - headBudget - tailBudget;
    const tailStart = fullLen - tailBudget;
    // 暴露字符区间，方便有 read 工具的 LLM 直接 mode="char" offset=headBudget limit=omitted 精准捞缺失部分
    const marker = `\n\n…[truncated: chars ${headBudget}..${tailStart} of ${fullLen} omitted (${omitted} chars); ${note}]…\n\n`;
    return head + marker + tail;
}

function sanitizeName(s: string): string {
    return (s || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64);
}
