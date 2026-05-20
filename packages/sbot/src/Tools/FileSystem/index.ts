/**
 * 文件系统工具集
 * 为 LLM 提供方便的本地文件读写操作能力
 * 注意：所有路径参数必须使用绝对路径
 */

import { type StructuredToolInterface } from '@langchain/core/tools';

export { formatSize } from './utils';

// 文件内容操作
export { createReadTool } from './content/read';
export { createReadMediaFileTool } from './content/readMediaFile';
export { createWriteTool } from './content/write';
export { createEditFileTool } from './content/edit';
export { createGrepFilesTool } from './content/grep';

// 文件系统操作
export { createGlobTool } from './operations/glob';
export { createLsTool } from './operations/ls';
export { createRmTool } from './operations/rm';
export { createMkdirTool } from './operations/mkdir';
export { createMvTool } from './operations/mv';
export { createCpTool } from './operations/cp';

import { createReadTool } from './content/read';
import { createReadMediaFileTool } from './content/readMediaFile';
import { createWriteTool } from './content/write';
import { createEditFileTool } from './content/edit';
import { createGrepFilesTool } from './content/grep';
import { createGlobTool } from './operations/glob';
import { createLsTool } from './operations/ls';
import { createRmTool } from './operations/rm';
import { createMkdirTool } from './operations/mkdir';
import { createMvTool } from './operations/mv';
import { createCpTool } from './operations/cp';

export interface FileSystemToolParams {
    /** 只读模式：仅暴露读类工具，过滤掉 write/edit/mkdir/rm/mv/cp。admin 端传字符串 "true"/"false"，所以这里要兼容两种形态 */
    readonly?: boolean | string;
}

function parseBool(v: unknown): boolean {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') return v.toLowerCase() === 'true';
    return false;
}

/** 创建所有文件系统工具 */
export function createFileSystemTools(params?: FileSystemToolParams): StructuredToolInterface[] {
    const readTools = [
        createReadTool(),
        createReadMediaFileTool(),
        createGrepFilesTool(),
        createGlobTool(),
        createLsTool(),
    ];
    if (parseBool(params?.readonly)) return readTools;
    return [
        ...readTools,
        createWriteTool(),
        createEditFileTool(),
        createMkdirTool(),
        createRmTool(),
        createMvTool(),
        createCpTool(),
    ];
}
