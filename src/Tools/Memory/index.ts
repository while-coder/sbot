/**
 * Memory 工具集
 * 提供记忆检索工具，供 LLM 按需获取记忆详情
 */

import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { IMemoryService } from '../../Memory';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from '../ToolsConfig';

/**
 * 创建记忆检索工具
 */
export function createRecallMemoryTool(memoryService: IMemoryService): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'recall_memory',
        description: '根据记忆 ID 获取记忆的完整内容。当你需要从记忆目录中查看某条记忆的详细信息时使用此工具。',
        schema: z.object({
            memoryIds: z.array(z.string()).describe('要查询的记忆 ID 数组（来自记忆目录）')
        }) as any,
        func: async ({ memoryIds }: { memoryIds: string[] }): Promise<MCPToolResult> => {
            const details = await memoryService.getMemoryDetails(memoryIds);
            if (details.length === 0) {
                return createErrorResult("未找到指定 ID 的记忆");
            }
            return createSuccessResult(
                createTextContent(JSON.stringify(details, null, 2))
            );
        }
    });
}

/**
 * 创建所有 Memory 相关工具
 */
export function createMemoryTools(memoryService: IMemoryService): StructuredToolInterface[] {
    return [
        createRecallMemoryTool(memoryService),
    ];
}
