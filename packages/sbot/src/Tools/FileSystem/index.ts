/**
 * 文件系统工具集
 * 为 LLM 提供方便的本地文件读写操作能力
 * 注意：所有路径参数必须使用绝对路径
 */

import { type StructuredToolInterface } from '@langchain/core/tools';
import { FileSystemToolsConfig } from './config';

export type { FileSystemToolsConfig } from './config';
export { formatSize } from './utils';

export { createReadFileTool } from './readFile';
export { createReadFileLinesTool } from './readFileLines';
export { createReadMediaFileTool } from './readMediaFile';
export { createWriteFileTool } from './writeFile';
export { createEditFileTool } from './editFile';
export { createAppendFileTool } from './appendFile';
export { createSearchInFileTool } from './searchInFile';
export { createSearchFilesTool } from './searchFiles';
export { createGrepFilesTool } from './grepFiles';
export { createListDirectoryTool } from './listDirectory';
export { createDeleteFileTool } from './deleteFile';
export { createFileExistsTool } from './fileExists';
export { createDirectoryTool } from './createDirectory';
export { createDeleteDirectoryTool } from './deleteDirectory';
export { createMoveFileTool } from './moveFile';
export { createCopyFileTool } from './copyFile';

import { createReadFileTool } from './readFile';
import { createReadFileLinesTool } from './readFileLines';
import { createReadMediaFileTool } from './readMediaFile';
import { createWriteFileTool } from './writeFile';
import { createEditFileTool } from './editFile';
import { createAppendFileTool } from './appendFile';
import { createSearchInFileTool } from './searchInFile';
import { createSearchFilesTool } from './searchFiles';
import { createGrepFilesTool } from './grepFiles';
import { createListDirectoryTool } from './listDirectory';
import { createDeleteFileTool } from './deleteFile';
import { createFileExistsTool } from './fileExists';
import { createDirectoryTool } from './createDirectory';
import { createDeleteDirectoryTool } from './deleteDirectory';
import { createMoveFileTool } from './moveFile';
import { createCopyFileTool } from './copyFile';

/** 创建所有文件系统工具 */
export function createFileSystemTools(config: FileSystemToolsConfig = { maxFileSize: 10 * 1024 * 1024 }): StructuredToolInterface[] {
    return [
        // 读取
        createReadFileTool(config),
        createReadFileLinesTool(config),
        createReadMediaFileTool(),
        // 写入/编辑
        createWriteFileTool(),
        createEditFileTool(),
        createAppendFileTool(),
        // 搜索
        createSearchInFileTool(config),
        createSearchFilesTool(),
        createGrepFilesTool(config),
        // 目录
        createListDirectoryTool(),
        createDirectoryTool(),
        createDeleteDirectoryTool(),
        // 文件操作
        createDeleteFileTool(),
        createMoveFileTool(),
        createCopyFileTool(),
        createFileExistsTool(),
    ];
}
