import {
    createShellTool as createCoreShellTool,
    createReadProcessTool as createCoreReadProcessTool,
    createWriteProcessTool as createCoreWriteProcessTool,
} from 'scorpio.ai';
import { type StructuredToolInterface } from '@langchain/core/tools';

export function createShellTool(description: string): StructuredToolInterface {
    return createCoreShellTool({
        description,
    });
}

export function createReadProcessTool(description: string): StructuredToolInterface {
    return createCoreReadProcessTool({
        description,
    });
}

export function createWriteProcessTool(description: string): StructuredToolInterface {
    return createCoreWriteProcessTool({
        description,
    });
}
