/**
 * 文件系统工具集
 * 为 LLM 提供方便的本地文件读写操作能力
 * 注意：所有路径参数必须使用绝对路径
 */

import { type StructuredToolInterface } from '@langchain/core/tools';
import { FileSystemToolsConfig } from './config';

export type { FileSystemToolsConfig } from './config';
export { formatSize } from './utils';

// 文件内容操作
export { createReadTool } from './content/read';
export { createReadFileLinesTool } from './content/readFileLines';
export { createReadMediaFileTool } from './content/readMediaFile';
export { createWriteTool } from './content/write';
export { createEditFileTool } from './content/editFile';
export { createAppendFileTool } from './content/appendFile';
export { createSearchInFileTool } from './content/searchInFile';
export { createGrepFilesTool } from './content/grepFiles';

// 文件系统操作
export { createSearchFilesTool } from './operations/searchFiles';
export { createLsTool } from './operations/ls';
export { createRmTool } from './operations/rm';
export { createFileExistsTool } from './operations/fileExists';
export { createMkdirTool } from './operations/mkdir';
export { createMvTool } from './operations/mv';
export { createCpTool } from './operations/cp';

import { createReadTool } from './content/read';
import { createReadFileLinesTool } from './content/readFileLines';
import { createReadMediaFileTool } from './content/readMediaFile';
import { createWriteTool } from './content/write';
import { createEditFileTool } from './content/editFile';
import { createAppendFileTool } from './content/appendFile';
import { createSearchInFileTool } from './content/searchInFile';
import { createGrepFilesTool } from './content/grepFiles';
import { createSearchFilesTool } from './operations/searchFiles';
import { createLsTool } from './operations/ls';
import { createRmTool } from './operations/rm';
import { createFileExistsTool } from './operations/fileExists';
import { createMkdirTool } from './operations/mkdir';
import { createMvTool } from './operations/mv';
import { createCpTool } from './operations/cp';

/** 创建所有文件系统工具 */
export function createFileSystemTools(config: FileSystemToolsConfig = { maxFileSize: 10 * 1024 * 1024 }): StructuredToolInterface[] {
    return [
        // 文件内容操作
        createReadTool(),
        createReadFileLinesTool(config),
        createReadMediaFileTool(),
        createWriteTool(),
        createEditFileTool(),
        createAppendFileTool(),
        createSearchInFileTool(config),
        createGrepFilesTool(config),
        // 文件系统操作
        createSearchFilesTool(),
        createLsTool(),
        createMkdirTool(),
        createRmTool(),
        createMvTool(),
        createCpTool(),
        createFileExistsTool(),
    ];
}
