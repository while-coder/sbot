/**
 * LSP 工具（Stub 实现）
 * 提供语言服务器协议的代码智能功能
 * 需要实际的 LSP server 集成，当前为 stub 实现
 */

import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { createTextContent, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { loadPrompt } from '../_prompts/index';

export function createLspTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'lsp',
        description: loadPrompt('lsp') || 'LSP 代码智能操作',
        schema: z.object({
            operation: z.enum([
                'goToDefinition',
                'findReferences',
                'hover',
                'documentSymbol',
                'workspaceSymbol',
                'goToImplementation',
                'prepareCallHierarchy',
                'incomingCalls',
                'outgoingCalls',
            ]).describe('LSP 操作类型'),
            filePath: z.string().describe('目标文件的绝对路径'),
            line: z.number().int().min(1).describe('行号（1-based）'),
            character: z.number().int().min(1).describe('列号（1-based）'),
        }) as any,
        func: async ({ operation, filePath, line, character }: any): Promise<MCPToolResult> => {
            return createSuccessResult(createTextContent(
                `[stub] lsp 工具尚未实现。操作: ${operation}, 文件: ${filePath}, 位置: ${line}:${character}`
            ));
        },
    });
}

export function createLspTools(): StructuredToolInterface[] {
    return [createLspTool()];
}
