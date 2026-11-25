import { z } from 'zod';
import { createAgentTool, type AgentTool } from 'scorpio.llm';
import { createErrorResult, createTextContent, type CommandToolResult } from './result';
import { runShellCommand } from './runtime/foreground';
import { resolveWorkingDir } from './runtime/process';
import { formatProcessResult, ProcessManager } from './runtime/processManager';

const execCommandSchema = z.object({
    cmd: z.string().regex(/\S/).optional().describe('Shell command or multiline script to start. Omit when using processId.'),
    workdir: z.string().min(1).optional().describe('Absolute directory for a new command. Defaults to the session workspace.'),
    timeoutMs: z.number().int().positive().max(2_147_483_647).optional().describe('Wait for a new command to finish and terminate it on timeout. Omit for resumable execution.'),
    yieldMs: z.number().int().min(0).optional().describe('Time in milliseconds to wait for output before returning a running processId. Defaults to 1000.'),
    interactive: z.boolean().optional().describe('Keep stdin open for a new resumable command. Defaults to false.'),
    processId: z.number().int().positive().optional().describe('Read output from this running process, or send input with stdin. Omit cmd.'),
    stdin: z.string().optional().describe('Input for a new command or an existing interactive process. Include a newline for line-oriented prompts.'),
    closeStdin: z.boolean().optional().describe('Send EOF to an existing interactive process.'),
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
            if (input.processId !== undefined) {
                if (input.cmd !== undefined || input.workdir !== undefined || input.timeoutMs !== undefined || input.interactive !== undefined) {
                    return createErrorResult('Use processId by itself to read output. Command startup options require cmd.');
                }
                const manager = processManagers.get(processOwner);
                if (!manager) return createErrorResult('No such process in this session.');
                if (input.terminate) {
                    if (input.stdin !== undefined || input.closeStdin) {
                        return createErrorResult('Terminate the process separately from sending input.');
                    }
                    const stopped = await manager.kill(input.processId);
                    if (!stopped) return createErrorResult('No such process in this session.');
                    return { content: [createTextContent('Process terminated.')] };
                }
                if (input.stdin !== undefined || input.closeStdin) {
                    return formatProcessResult(await manager.writeProcess(input.processId, input.stdin ?? '', input.closeStdin ?? false));
                }
                return formatProcessResult(await manager.readProcess(input.processId, input.yieldMs ?? 1000));
            }

            if (!input.cmd || input.closeStdin || input.terminate) {
                return createErrorResult('Provide cmd to start a command, or processId to manage an existing process.');
            }
            if (input.timeoutMs !== undefined && (input.interactive || input.yieldMs !== undefined)) {
                return createErrorResult('Use timeoutMs for a non-interactive command that must finish before returning, or yieldMs for resumable execution.');
            }
            const { cwd, error } = await resolveWorkingDir(input.workdir ?? workdir);
            if (!cwd) return createErrorResult(error ?? 'Could not resolve working directory.');
            if (input.timeoutMs !== undefined) {
                return runShellCommand(input.cmd, cwd, input.timeoutMs, 'exec_command', input.stdin);
            }
            const manager = getProcessManager(processOwner);
            return formatProcessResult(await manager.exec(input.cmd, cwd, input.yieldMs ?? 1000, input.stdin, input.interactive));
        },
    });
}
