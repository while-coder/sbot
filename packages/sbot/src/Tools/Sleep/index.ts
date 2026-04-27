import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { createTextContent, createSuccessResult, type MCPToolResult } from 'scorpio.ai';

export const SLEEP_TOOL_NAME = 'sleep' as const;

export function createSleepTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: SLEEP_TOOL_NAME,
        description: 'Wait for a specified number of seconds before continuing. Use when you need to pause execution, e.g. waiting for an external process to complete.',
        schema: z.object({
            seconds: z.number().min(0).max(300).describe('Number of seconds to sleep (0-300)'),
        }) as any,
        func: async ({ seconds }: any): Promise<MCPToolResult> => {
            await new Promise(resolve => setTimeout(resolve, seconds * 1000));
            return createSuccessResult(createTextContent(`Slept for ${seconds} second(s).`));
        },
    });
}
