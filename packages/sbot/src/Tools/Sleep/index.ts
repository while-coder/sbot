import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { createTextContent, createSuccessResult, type MCPToolResult } from 'scorpio.ai';
import { loadPrompt } from '../../Core/PromptLoader';

export const SLEEP_TOOL_NAME = 'sleep' as const;

export function createSleepTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: SLEEP_TOOL_NAME,
        description: loadPrompt('tools/sleep/sleep.txt'),
        schema: z.object({
            seconds: z.number().min(0).max(300).describe('Number of seconds to sleep (0-300)'),
        }) as any,
        func: async ({ seconds }: any): Promise<MCPToolResult> => {
            await new Promise(resolve => setTimeout(resolve, seconds * 1000));
            return createSuccessResult(createTextContent(`Slept for ${seconds} second(s).`));
        },
    });
}
