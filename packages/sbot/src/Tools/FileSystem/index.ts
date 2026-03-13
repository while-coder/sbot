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
export { createReadFileTool } from './content/readFile';
export { createReadFileLinesTool } from './content/readFileLines';
export { createReadMediaFileTool } from './content/readMediaFile';
export { createWriteFileTool } from './content/writeFile';
export { createEditFileTool } from './content/editFile';
export { createAppendFileTool } from './content/appendFile';
export { createSearchInFileTool } from './content/searchInFile';
export { createGrepFilesTool } from './content/grepFiles';

// 文件系统操作
export { createSearchFilesTool } from './operations/searchFiles';
export { createLsTool } from './operations/ls';
export { createDeleteFileTool } from './operations/deleteFile';
export { createFileExistsTool } from './operations/fileExists';
export { createDirectoryTool } from './operations/createDirectory';
export { createDeleteDirectoryTool } from './operations/deleteDirectory';
export { createMvTool } from './operations/mv';
export { createCopyFileTool } from './operations/copyFile';

import { createReadFileTool } from './content/readFile';
import { createReadFileLinesTool } from './content/readFileLines';
import { createReadMediaFileTool } from './content/readMediaFile';
import { createWriteFileTool } from './content/writeFile';
import { createEditFileTool } from './content/editFile';
import { createAppendFileTool } from './content/appendFile';
import { createSearchInFileTool } from './content/searchInFile';
import { createGrepFilesTool } from './content/grepFiles';
import { createSearchFilesTool } from './operations/searchFiles';
import { createLsTool } from './operations/ls';
import { createDeleteFileTool } from './operations/deleteFile';
import { createFileExistsTool } from './operations/fileExists';
import { createDirectoryTool } from './operations/createDirectory';
import { createDeleteDirectoryTool } from './operations/deleteDirectory';
import { createMvTool } from './operations/mv';
import { createCopyFileTool } from './operations/copyFile';

/** 创建所有文件系统工具 */
export function createFileSystemTools(config: FileSystemToolsConfig = { maxFileSize: 10 * 1024 * 1024 }): StructuredToolInterface[] {
    return [
        // 文件内容操作
        createReadFileTool(config),
        createReadFileLinesTool(config),
        createReadMediaFileTool(),
        createWriteFileTool(),
        createEditFileTool(),
        createAppendFileTool(),
        createSearchInFileTool(config),
        createGrepFilesTool(config),
        // 文件系统操作
        createSearchFilesTool(),
        createLsTool(),
        createDirectoryTool(),
        createDeleteDirectoryTool(),
        createDeleteFileTool(),
        createMvTool(),
        createCopyFileTool(),
        createFileExistsTool(),
    ];
}
