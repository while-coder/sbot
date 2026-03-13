/**
 * 文件系统工具集
 * 为 LLM 提供方便的本地文件读写操作能力
 * 注意：所有路径参数必须使用绝对路径
 */

import { type StructuredToolInterface } from '@langchain/core/tools';

export { formatSize } from './utils';

// 文件内容操作
export { createReadTool } from './content/read';
export { createReadBinaryFileTool } from './content/readBinaryFile';
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
import { createReadBinaryFileTool } from './content/readBinaryFile';
import { createWriteTool } from './content/write';
import { createEditFileTool } from './content/edit';
import { createGrepFilesTool } from './content/grep';
import { createGlobTool } from './operations/glob';
import { createLsTool } from './operations/ls';
import { createRmTool } from './operations/rm';
import { createMkdirTool } from './operations/mkdir';
import { createMvTool } from './operations/mv';
import { createCpTool } from './operations/cp';

/** 创建所有文件系统工具 */
export function createFileSystemTools(): StructuredToolInterface[] {
    return [
        // 文件内容操作
        createReadTool(),
        createReadBinaryFileTool(),
        createWriteTool(),
        createEditFileTool(),
        createGrepFilesTool(),
        // 文件系统操作
        createGlobTool(),
        createLsTool(),
        createMkdirTool(),
        createRmTool(),
        createMvTool(),
        createCpTool(),
    ];
}
