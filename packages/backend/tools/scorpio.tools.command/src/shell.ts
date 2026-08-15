import {
    createShellTool as createCoreShellTool,
    createReadProcessTool as createCoreReadProcessTool,
    createWriteProcessTool as createCoreWriteProcessTool,
    type ProcessManager,
} from 'scorpio.command';
import { type StructuredToolInterface } from '@langchain/core/tools';

export function createShellTool(description: string, processManager: ProcessManager): StructuredToolInterface {
    return createCoreShellTool({
        description,
        processManager,
    });
}

export function createReadProcessTool(description: string, processManager: ProcessManager): StructuredToolInterface {
    return createCoreReadProcessTool({
        description,
        processManager,
    });
}

export function createWriteProcessTool(description: string, processManager: ProcessManager): StructuredToolInterface {
    return createCoreWriteProcessTool({
        description,
        processManager,
    });
}
