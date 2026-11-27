import { z } from 'zod';
import { createAgentTool, type AgentTool } from 'scorpio.llm';
import { createErrorResult, createTextContent, type CommandToolResult } from './result';
import { runShellCommand } from './runtime/foreground';
import { resolveWorkingDir } from './runtime/process';
import { formatProcessResult, ProcessManager } from './runtime/processManager';

const execCommandSchema = z.object({
    cmd: z.string().regex(/\S/).describe('Shell command or multiline script to start.'),
    workdir: z.string().min(1).optional().describe('Absolute directory for a new command. Defaults to the session workspace.'),
    timeoutMs: z.number().int().positive().max(2_147_483_647).optional().describe('Wait for a new command to finish and terminate it on timeout. Omit for resumable execution.'),
    stdin: z.string().optional().describe('Text to write at startup before closing standard input.'),
});

const writeStdinSchema = z.object({
    processId: z.number().int().positive().describe('Process ID returned by exec_command.'),
    yieldMs: z.number().int().min(0).optional().describe('Milliseconds to wait for output. Defaults to 1000.'),
    terminate: z.boolean().optional().describe('Stop the existing process and its child processes.'),
});

type ExecCommandInput = z.infer<typeof execCommandSchema>;

interface ExecCommandOptions {
    description: string;
    workdir?: string;
    processOwner?: string;
}

const processManagers = new Map<string, ProcessManager>();

function getProcessManager(owner: string): ProcessManager {
    const existing = processManagers.get(owner);
    if (existing) return existing;
    const manager = new ProcessManager(() => processManagers.delete(owner));
    processManagers.set(owner, manager);
    return manager;
}

export function createExecCommandTool({ description, workdir, processOwner = 'default' }: ExecCommandOptions): AgentTool {
    return createAgentTool({
        name: 'exec_command',
        description,
        schema: execCommandSchema,
        async func(input: ExecCommandInput): Promise<CommandToolResult> {
            const { cwd, error } = await resolveWorkingDir(input.workdir ?? workdir);
            if (!cwd) return createErrorResult(error ?? 'Could not resolve working directory.');
            if (input.timeoutMs !== undefined) {
                return runShellCommand(input.cmd, cwd, input.timeoutMs, 'exec_command', input.stdin);
            }
            const manager = getProcessManager(processOwner);
            return formatProcessResult(await manager.exec(input.cmd, cwd, 1000, input.stdin));
        },
    });
}

export function createWriteStdinTool(processOwner = 'default'): AgentTool {
    return createAgentTool({
        name: 'write_stdin',
        description: 'Read output or stop an existing exec_command process in the current session.',
        schema: writeStdinSchema,
        async func({ processId, terminate, yieldMs }: z.infer<typeof writeStdinSchema>): Promise<CommandToolResult> {
            const manager = processManagers.get(processOwner);
            if (!manager) return createErrorResult('No such process in this session.');
            if (terminate) {
                if (!await manager.kill(processId)) return createErrorResult('No such process in this session.');
                return { content: [createTextContent('Process terminated.')] };
            }
            return formatProcessResult(await manager.readProcess(processId, yieldMs ?? 1000));
        },
    });
}
