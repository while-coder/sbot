/**
 * Prompt 加载工具
 * 从 src/prompts/tools/ 或 dist/prompts/tools/ 读取工具描述文件
 */

import fs from 'fs';
import path from 'path';

// 从编译后位置 dist/Tools/_prompts/ 推算路径
const distPromptDir = path.resolve(__dirname, '../../prompts/tools');
const srcPromptDir = path.resolve(__dirname, '../../../src/prompts/tools');

const cache = new Map<string, string>();

/**
 * 加载指定名称的 prompt 文件内容
 * 优先从 dist/prompts/tools/ 读取，fallback 到 src/prompts/tools/
 */
export function loadPrompt(name: string): string {
    if (cache.has(name)) return cache.get(name)!;

    for (const dir of [distPromptDir, srcPromptDir]) {
        const filePath = path.join(dir, `${name}.txt`);
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf-8');
            cache.set(name, content);
            return content;
        }
    }

    return '';
}
