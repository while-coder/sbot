import { type AgentTool } from "scorpio.ai";
import { createZipCompressTool } from './compress';
import { createZipExtractTool } from './extract';
import { createZipListTool } from './list';
import { createZipReadFileTool } from './read';

export { createZipCompressTool, createZipExtractTool, createZipListTool, createZipReadFileTool };

/** 创建所有 ZIP 压缩工具 */
export function createArchiveTools(): AgentTool[] {
    return [
        createZipCompressTool(),
        createZipExtractTool(),
        createZipListTool(),
        createZipReadFileTool(),
    ];
}
