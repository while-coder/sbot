import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { createTextContent, createSuccessResult, type MCPToolResult } from 'scorpio.ai';

export const TIME_TOOL_NAME = 'get_current_time' as const;

export function createTimeTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: TIME_TOOL_NAME,
        description: 'Get the current date and time with timezone information.',
        schema: z.object({}) as any,
        func: async (): Promise<MCPToolResult> => {
            const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
            const now = new Date().toLocaleString(undefined, { timeZone: timezone, hour12: false });
            return createSuccessResult(createTextContent(`${now} (${timezone})`));
        },
    });
}
