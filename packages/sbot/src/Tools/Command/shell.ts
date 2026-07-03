import {
    createShellTool as createCoreShellTool,
    createReadProcessTool as createCoreReadProcessTool,
} from 'scorpio.ai';
import { type StructuredToolInterface } from '@langchain/core/tools';
import { loadPrompt } from '../../Core/PromptLoader';

export function createShellTool(): StructuredToolInterface {
    return createCoreShellTool({
        description: loadPrompt('tools/command/shell.txt'),
    });
}

export function createReadProcessTool(): StructuredToolInterface {
    return createCoreReadProcessTool({
        description: loadPrompt('tools/command/read_process.txt'),
    });
}
