import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createAgentTool, createErrorResult, createTextContent } from 'scorpio.ai';
import { z } from 'zod';

export function createApplyPatchTool(workdir?: string) {
    return createAgentTool({
        name: 'apply_patch',
        description: 'Apply a Git unified diff with a/ and b/ paths relative to the session workspace. Include context around edits. Use a patch with all related changes in one call.',
        schema: z.object({
            patch: z.string().min(1).max(1024 * 1024).describe('Unified diff, as produced by git diff.'),
        }),
        async func({ patch }) {
            if (!workdir) return createErrorResult('A session workspace is required to apply a patch.');

            const cwd = await fs.realpath(workdir);
            // Keep relative paths anchored to the session, including sessions in a repository subdirectory.
            const env: NodeJS.ProcessEnv = { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(cwd) };
            for (const name of Object.keys(env)) {
                if (/^GIT_(DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|PREFIX)$/i.test(name)) delete env[name];
            }

            return new Promise((resolve, reject) => {
                const child = spawn('git', ['apply', '--recount', '--whitespace=nowarn', '--verbose', '-'], {
                    cwd, env, stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true,
                });
                let output = '';
                child.stderr.setEncoding('utf8');
                child.stderr.on('data', chunk => { output = (output + chunk).slice(-8192); });
                child.once('error', reject);
                child.once('close', code => {
                    if (code === 0) {
                        resolve({ content: [createTextContent(output.trim() || 'Patch applied.')] });
                    } else {
                        resolve(createErrorResult(output.trim() || `git apply failed (${code ?? 'terminated'}).`));
                    }
                });
                // Git may close stdin early if it rejects the patch. Its exit and stderr are authoritative.
                child.stdin.on('error', (error: NodeJS.ErrnoException) => { if (error.code !== 'EPIPE') reject(error); });
                child.stdin.end(patch.endsWith('\n') ? patch : patch + '\n', 'utf8');
            });
        },
    });
}
