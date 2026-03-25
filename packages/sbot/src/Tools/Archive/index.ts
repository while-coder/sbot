import { type StructuredToolInterface } from '@langchain/core/tools';
import { createZipCompressTool } from './compress';
import { createZipExtractTool } from './extract';
import { createZipListTool } from './list';
import { createZipReadFileTool } from './read';

export { createZipCompressTool, createZipExtractTool, createZipListTool, createZipReadFileTool };

/** 创建所有 ZIP 压缩工具 */
export function createArchiveTools(): StructuredToolInterface[] {
    return [
        createZipCompressTool(),
        createZipExtractTool(),
        createZipListTool(),
        createZipReadFileTool(),
    ];
}
