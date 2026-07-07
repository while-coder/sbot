import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { z } from 'zod';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { createErrorResult, type MCPToolResult } from '../Core';
import { runProgram, runShellCommand } from './runtime/foreground';
import { isCommandAvailable, resolveWorkingDir } from './runtime/process';
import { processManager, formatProcessResult } from './runtime/processManager';

export enum CodeRuntime {
    Shell = 'shell',
    PowerShell = 'powershell',
    Python = 'python',
    NodeJs = 'nodejs',
}

export enum CodeToolMode {
    Sync = 'sync',
    Background = 'background',
}

export { CodeToolMode as ShellToolMode, CodeToolMode as ScriptCodeMode };

function normalizeStdin(stdin: unknown): string | undefined {
    if (stdin == null) return undefined;
    return typeof stdin === 'string' ? stdin : JSON.stringify(stdin);
}

function withExecutionMode<T extends z.ZodRawShape>(base: z.ZodObject<T>) {
    return base.extend({
        mode: z.enum(CodeToolMode).describe('sync = run synchronously and return final output; background = start a process and use read_process for later output'),
        timeout: z.number().optional().describe('For mode=sync: timeout in milliseconds, default 60000 (60 s)'),
        yieldMs: z.number().optional().describe('For mode=background: how long to wait for immediate completion before returning a processId, default 1000 ms'),
        interactive: z.boolean().optional().describe('For mode=background: keep stdin open so write_process can send more input later. Use only for programs that prompt for stdin; this is pipe-based, not a full TTY.'),
    });
}

const shellCodeBaseSchema = z.object({
    code:       z.string().min(1).describe('Command or multi-line shell script to run, e.g. "git status", "npm install && npm run build", or a newline-separated script'),
    workingDir: z.string().describe('Absolute path of the working directory'),
    stdin:      z.any().optional().describe('Data to pipe into the command via stdin. Prefer a string; objects/arrays are auto-serialized to JSON.'),
});

const scriptCodeBaseSchema = z.object({
    code:       z.string().min(1).describe('Script source code to execute; written to a temp file automatically'),
    workingDir: z.string().describe('Absolute path of the working directory for the script'),
    stdin:      z.any().optional().describe('Data to pipe into the script via stdin. Prefer a string; objects/arrays are auto-serialized to JSON.'),
});

export const shellToolSchema = withExecutionMode(shellCodeBaseSchema);
export const scriptCodeSchema = withExecutionMode(scriptCodeBaseSchema);

export const readProcessToolSchema = z.object({
    processId: z.number().int().positive().describe('The numeric processId returned by shell/script mode="background"'),
    yieldMs: z.number().optional().describe('How long to wait for new output, default 1000 ms'),
});

export const writeProcessToolSchema = z.object({
    processId: z.number().int().positive().describe('The numeric processId returned by shell/script mode="background" with interactive=true'),
    stdin:     z.any().optional().describe('Data to write to the background process stdin. Prefer a string and include a trailing newline for line prompts; objects/arrays are auto-serialized to JSON.'),
    close:     z.boolean().optional().describe('Whether to close stdin after writing. Use true when the process needs EOF to continue or finish.'),
});

type ShellToolInput = z.infer<typeof shellToolSchema>;
type ScriptCodeInput = z.infer<typeof scriptCodeSchema>;
type ReadProcessToolInput = z.infer<typeof readProcessToolSchema>;
type WriteProcessToolInput = z.infer<typeof writeProcessToolSchema>;
type CodeToolInput = ShellToolInput | ScriptCodeInput;

export interface ShellToolOptions {
    name?: string;
    description: string;
}

export interface ReadProcessToolOptions {
    name?: string;
    description: string;
}

export interface WriteProcessToolOptions {
    name?: string;
    description: string;
}

export interface ScriptCodeToolOptions {
    name:        string;
    description: string;
    runtime:     CodeRuntime;
    interpreter: string;
    preArgs?:    string[];
    ext:         string;
}

interface ExecuteCodeOptions {
    runtime:     CodeRuntime;
    label:       string;
    interpreter?: string;
    preArgs?:    string[];
    ext?:        string;
}

async function executeCode(input: CodeToolInput, opts: ExecuteCodeOptions): Promise<MCPToolResult> {
    const { cwd, error: cwdError } = await resolveWorkingDir(input.workingDir);
    if (cwdError) return createErrorResult(cwdError);

    const stdin = normalizeStdin(input.stdin);
    if (opts.runtime === CodeRuntime.Shell) {
        if (input.mode === CodeToolMode.Background) {
            const result = await processManager.exec(input.code, cwd!, input.yieldMs ?? 1000, stdin, input.interactive ?? false);
            return formatProcessResult(result);
        }
        return runShellCommand(input.code, cwd!, input.timeout ?? 60000, `command "${input.code}"`, stdin);
    }

    if (!opts.interpreter || !opts.ext) {
        return createErrorResult(`Missing interpreter configuration for ${opts.runtime}`);
    }

    const tmpFile = path.join(os.tmpdir(), `sbot_script_${Date.now()}_${crypto.randomBytes(6).toString('hex')}${opts.ext}`);
    try {
        await fs.promises.writeFile(tmpFile, input.code, 'utf8');
    } catch (e: any) {
        return createErrorResult(`Failed to write temp script: ${e?.message ?? e}`);
    }

    let cleanupByBackgroundManager = false;
    const cleanupTempFile = async () => {
        try { await fs.promises.unlink(tmpFile); } catch { /* ignore */ }
    };

    try {
        const runArgs = [...(opts.preArgs ?? []), tmpFile];
        if (input.mode === CodeToolMode.Background) {
            cleanupByBackgroundManager = true;
            const result = await processManager.runProgram(
                opts.interpreter,
                runArgs,
                cwd!,
                input.yieldMs ?? 1000,
                stdin,
                cleanupTempFile,
                input.interactive ?? false,
            );
            return formatProcessResult(result);
        }
        return runProgram(opts.interpreter, runArgs, cwd!, input.timeout ?? 60000, opts.label, stdin);
    } finally {
        if (!cleanupByBackgroundManager) await cleanupTempFile();
    }
}

export function createShellTool({ name = 'shell', description }: ShellToolOptions): StructuredToolInterface {
    return new DynamicStructuredTool({
        name,
        description,
        schema: shellToolSchema as any,
        func: async (input: ShellToolInput): Promise<MCPToolResult> => executeCode(input, {
            runtime: CodeRuntime.Shell,
            label:   name,
        }),
    });
}

export function createScriptCodeTool({ name, description, runtime, interpreter, preArgs = [], ext }: ScriptCodeToolOptions): StructuredToolInterface | null {
    if (!isCommandAvailable(interpreter)) return null;
    return new DynamicStructuredTool({
        name,
        description,
        schema: scriptCodeSchema as any,
        func: async (input: ScriptCodeInput): Promise<MCPToolResult> => executeCode(input, {
            runtime,
            label: name,
            interpreter,
            preArgs,
            ext,
        }),
    });
}

export function createReadProcessTool({ name = 'read_process', description }: ReadProcessToolOptions): StructuredToolInterface {
    return new DynamicStructuredTool({
        name,
        description,
        schema: readProcessToolSchema as any,
        func: async ({ processId, yieldMs = 1000 }: ReadProcessToolInput): Promise<MCPToolResult> => {
            const result = await processManager.readProcess(processId, yieldMs);
            return formatProcessResult(result);
        },
    });
}

export function createWriteProcessTool({ name = 'write_process', description }: WriteProcessToolOptions): StructuredToolInterface {
    return new DynamicStructuredTool({
        name,
        description,
        schema: writeProcessToolSchema as any,
        func: async ({ processId, stdin, close = false }: WriteProcessToolInput): Promise<MCPToolResult> => {
            const result = await processManager.writeProcess(processId, normalizeStdin(stdin) ?? '', close);
            return formatProcessResult(result);
        },
    });
}
