import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { Op } from 'sequelize';
import { z } from 'zod';
import { createAgentTool, ToolApproval } from 'scorpio.ai';
import { AgentRunner } from './AgentRunner';
import { FeatureLoopWorkspace, git } from './FeatureLoopWorkspace';
import { AgentMode, config } from '../Core/Config';
import { database } from '../Core/Database';
import { LoggerService } from '../Core/LoggerService';

const logger = LoggerService.getLogger('FeatureLoopService');
const reportToolName = 'report_feature_stage';
const leaseMs = 60_000;
const stageTimeoutMs = 30 * 60_000;

const roleSchema = z.object({
    agentId: z.string().trim().min(1),
    tools: z.array(z.string().trim().min(1)).default([]),
});

export const createFeatureLoopSchema = z.object({
    repository: z.string().trim().min(1),
    goal: z.string().trim().min(1).max(8_000),
    saverId: z.string().trim().min(1),
    roles: z.object({ planner: roleSchema, product: roleSchema, engineering: roleSchema, qa: roleSchema }),
    maxFeatures: z.number().int().min(1).optional(),
    maxRevisions: z.number().int().min(1).max(25).default(5),
});

const summary = z.string().trim().min(1).max(16_000);
const reportSchema = z.object({
    summary,
    title: z.string().trim().min(1).max(120).regex(/^[^\r\n]+$/).optional(),
    spec: z.string().trim().min(1).max(60_000).optional(),
    verdict: z.enum(['pass', 'product_issue', 'implementation_issue', 'blocked']).optional(),
    evidence: z.array(summary).max(50).optional(),
});

type LoopInput = z.output<typeof createFeatureLoopSchema>;
type Role = keyof LoopInput['roles'];
type Report = z.output<typeof reportSchema>;
type Stage = 'prepare' | 'select' | 'product' | 'implement' | 'qa' | 'commit' | 'complete';

interface Feature {
    id: string;
    title: string;
    proposal: string;
    base: string;
    specPath: string;
    specHash?: string;
    implementation?: string;
    revisions: number;
    review?: Report;
    approvedTree?: string;
    approvedSpec?: string;
}

interface LoopState extends LoopInput {
    stage: Stage;
    initialBase: string;
    feature?: Feature;
    completed: number;
    lastCommit?: string;
    lastFeature?: { title: string; specPath: string; review?: Report };
    lastError?: string;
}

interface LoopRow {
    id: string;
    paused: boolean;
    state: string;
    owner: string | null;
    leaseUntil: number | null;
}

function fail(message: string, status: number): never {
    throw Object.assign(new Error(message), { status });
}

export class FeatureLoopService {
    private readonly owner = randomUUID();
    private timer?: NodeJS.Timeout;
    private current?: Promise<void>;
    private stopping = true;

    start(): void {
        this.stopping = false;
        this.wake();
    }

    async stop(): Promise<void> {
        this.stopping = true;
        clearTimeout(this.timer);
        await this.current;
    }

    async create(input: LoopInput) {
        for (const role of Object.values(input.roles)) {
            if (config.getAgent(role.agentId).type !== AgentMode.Single) {
                fail(`Feature Loop role "${role.agentId}" must use Single mode`, 400);
            }
        }
        if (!config.getSaver(input.saverId)) fail('Unknown saver', 400);
        const repository = await realpath(await git(input.repository, 'rev-parse', '--show-toplevel'));
        const initialBase = await git(repository, 'rev-parse', 'HEAD');
        const id = randomUUID();
        const state: LoopState = { ...input, repository, initialBase, stage: 'prepare', completed: 0 };
        await database.create(database.featureLoop, { id, paused: false, state: JSON.stringify(state) });
        this.wake();
        return this.get(id);
    }

    async list() {
        const rows = await database.findAll<LoopRow>(database.featureLoop);
        return rows.map(row => this.view(row));
    }

    async get(id: string) {
        return this.view(await this.row(id));
    }

    async pause(id: string) {
        await this.row(id);
        await database.update(database.featureLoop, { paused: true }, { where: { id } });
        return this.get(id);
    }

    async getSpec(id: string) {
        const state = this.decode(await this.row(id));
        if (!state.feature) fail('There is no active feature spec', 404);
        const workspace = this.workspace(id);
        const spec = await this.readEditableSpec(workspace, state.feature);
        return { ...spec, path: state.feature.specPath };
    }

    private async readEditableSpec(workspace: FeatureLoopWorkspace, feature: Feature) {
        return workspace.readSpec(feature.specPath).catch(error => {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') fail('The product spec has not been written', 404);
            throw error;
        });
    }

    async resume(id: string, useCurrentSpec: boolean, edit?: { text: string; hash: string }) {
        const row = await this.row(id);
        if (!row.paused) fail('Pause the Feature Loop before resuming it', 409);
        if (row.leaseUntil && row.leaseUntil > Date.now()) fail('The current stage is still running', 409);
        const state = this.decode(row);
        if (state.stage === 'complete') fail('This Feature Loop is complete', 409);
        const editOwner = edit ? randomUUID() : row.owner;
        const editLease = edit ? Date.now() + leaseMs : row.leaseUntil;
        const snapshot = { id, paused: true, state: row.state, owner: row.owner, leaseUntil: row.leaseUntil };
        if (edit) {
            const [claimed] = await database.update(database.featureLoop, { owner: editOwner, leaseUntil: editLease }, { where: snapshot });
            if (!claimed) fail('Feature Loop changed while editing', 409);
        }
        try {
            if (useCurrentSpec || edit) {
                if (!state.feature) fail('There is no active feature spec', 409);
                const workspace = this.workspace(id);
                if (await workspace.head() !== state.feature.base) {
                    fail('The feature branch HEAD has changed. Resume without replacing the spec to recover a published commit.', 409);
                }
                const currentSpec = await this.readEditableSpec(workspace, state.feature);
                if (edit) {
                    if (currentSpec.hash !== edit.hash) fail('The product spec changed. Reopen it before applying edits.', 409);
                    await workspace.writeSpec(state.feature.specPath, edit.text);
                }
                state.feature.specHash = edit
                    ? (await this.readEditableSpec(workspace, state.feature)).hash
                    : currentSpec.hash;
                this.returnToEngineering(state);
            }
            state.lastError = undefined;
            const [updated] = await database.update(database.featureLoop, { paused: false, state: JSON.stringify(state), owner: null, leaseUntil: null }, {
                where: { ...snapshot, owner: editOwner, leaseUntil: editLease },
            });
            if (!updated) fail('Feature Loop changed while resuming', 409);
        } finally {
            if (edit) {
                await database.update(database.featureLoop, { owner: null, leaseUntil: null }, { where: { id, owner: editOwner } });
            }
        }
        this.wake();
        return this.get(id);
    }

    private async row(id: string): Promise<LoopRow> {
        const row = await database.findByPk<LoopRow>(database.featureLoop, id);
        return row ?? fail('Feature Loop not found', 404);
    }

    private decode(row: LoopRow): LoopState {
        return JSON.parse(row.state) as LoopState;
    }

    private workspace(id: string): FeatureLoopWorkspace {
        return new FeatureLoopWorkspace(path.join(config.getConfigPath('feature-loops', true), id), id);
    }

    private view(row: LoopRow) {
        const state = this.decode(row);
        const workspace = this.workspace(row.id);
        const running = Boolean(row.leaseUntil && row.leaseUntil > Date.now());
        return { id: row.id, worktree: workspace.directory, branch: workspace.branch, paused: Boolean(row.paused), running, ...state };
    }

    private wake(delay = 0): void {
        if (this.stopping || this.current) return;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            this.current = this.tick().catch(error => logger.error(error)).finally(() => {
                this.current = undefined;
                this.wake(500);
            });
        }, delay);
    }

    private async tick(): Promise<void> {
        const rows = await database.findAll<LoopRow>(database.featureLoop, { where: { paused: false } });
        for (const row of rows) {
            if (this.stopping) break;
            const state = this.decode(row);
            if (state.stage === 'complete') continue;
            const [claimed] = await database.update(database.featureLoop, { owner: this.owner, leaseUntil: Date.now() + leaseMs }, {
                where: { id: row.id, paused: false, state: row.state, [Op.or]: [
                    { leaseUntil: null }, { leaseUntil: { [Op.lte]: Date.now() } },
                ] },
            });
            if (claimed) await this.runStage(row.id, state);
        }
    }

    private async runStage(id: string, state: LoopState): Promise<void> {
        const controller = new AbortController();
        const deadline = Date.now() + stageTimeoutMs;
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(stageTimeoutMs)]);
        let renewal = Promise.resolve();
        const refresh = setInterval(() => {
            renewal = renewal.then(async () => {
                const now = Date.now();
                const [owned] = await database.update(database.featureLoop, { leaseUntil: now + leaseMs },
                    { where: { id, owner: this.owner, leaseUntil: { [Op.gt]: now } } });
                if (!owned) controller.abort(new Error('Feature Loop lease was lost'));
            }).catch(error => controller.abort(error));
        }, leaseMs / 4);
        let pause = false;
        try {
            pause = await this.advance(id, state, signal, deadline);
            signal.throwIfAborted();
        } catch (error) {
            // Reload the stage checkpoint so partial in-memory updates can be retried.
            state = this.decode(await this.row(id));
            state.lastError = error instanceof Error ? error.message : String(error);
            logger.warn(`Feature Loop ${id} stopped at ${state.stage}: ${state.lastError}`);
            pause = true;
        } finally {
            clearInterval(refresh);
            await renewal;
        }
        await database.update(database.featureLoop, {
            state: JSON.stringify(state),
            owner: null,
            leaseUntil: null,
            ...(pause ? { paused: true } : {}),
        }, { where: { id, owner: this.owner, leaseUntil: { [Op.gt]: Date.now() } } });
    }

    private returnToEngineering(state: LoopState): void {
        state.stage = 'implement';
        state.feature!.approvedSpec = undefined;
        state.feature!.approvedTree = undefined;
    }

    private async advance(id: string, state: LoopState, signal: AbortSignal, deadline: number): Promise<boolean> {
        const workspace = this.workspace(id);
        if (state.stage === 'prepare') {
            await workspace.prepare(state.repository, state.initialBase);
            state.stage = 'select';
            return false;
        }
        if (state.stage === 'select') {
            const base = state.lastCommit ?? state.initialBase;
            const before = await workspace.snapshot(base);
            if (before !== await git(workspace.directory, 'rev-parse', 'HEAD^{tree}')) {
                throw new Error('The worktree contains changes outside an active feature');
            }
            const report = await this.runRole(id, state, workspace, 'planner',
                'Inspect the project and its Git history. Propose exactly one small feature within the goal, with a title and rationale. Keep the worktree read-only.', signal, deadline);
            if (!report.title) throw new Error('Planner did not provide a feature title');
            if (await workspace.snapshot(base) !== before) throw new Error('Planner modified the worktree');
            const featureId = randomUUID();
            state.feature = { id: featureId, base, title: report.title, proposal: report.summary,
                specPath: `.sbot-features/${featureId}.md`, revisions: 0 };
            state.stage = 'product';
            return false;
        }

        const feature = state.feature;
        if (!feature) throw new Error('Missing active Feature Loop feature');
        if (state.stage === 'commit') {
            const approvedTree = feature.approvedTree;
            if (!approvedTree || !feature.approvedSpec) throw new Error('Missing QA approval');
            let commit = await workspace.publishedCommit(feature.base, feature.id, approvedTree);
            if (!commit) {
                const spec = await workspace.readSpec(feature.specPath);
                const currentTree = await workspace.snapshot(feature.base);
                if (spec.hash !== feature.approvedSpec) {
                    this.returnToEngineering(state);
                    return false;
                }
                if (currentTree !== approvedTree) {
                    state.stage = 'qa';
                    feature.approvedTree = undefined;
                    return false;
                }
                signal.throwIfAborted();
                if ((await this.row(id)).paused) return false;
                commit = await workspace.publish(feature.base, feature.id, approvedTree, feature.title);
            }
            state.lastCommit = commit;
            state.lastFeature = { title: feature.title, specPath: feature.specPath, review: feature.review };
            state.completed++;
            state.feature = undefined;
            state.stage = state.maxFeatures && state.completed >= state.maxFeatures ? 'complete' : 'select';
            return false;
        }

        if (state.stage === 'product') {
            const before = await workspace.snapshot(feature.base);
            const previous = await workspace.readSpec(feature.specPath).catch(error => {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
                throw error;
            });
            const report = await this.runRole(id, state, workspace, 'product',
                `Write the full Markdown spec with individually verifiable acceptance criteria in the spec field. Keep the worktree read-only.\nPrevious spec:\n${previous?.text ?? '(new feature)'}`, signal, deadline);
            if (!report.spec) throw new Error('Product agent did not provide a spec');
            if (await workspace.snapshot(feature.base) !== before) throw new Error('Product stage changed the worktree; retry with the current spec if the edit was intentional');
            signal.throwIfAborted();
            await workspace.writeSpec(feature.specPath, `${report.spec}\n`);
            feature.specHash = (await workspace.readSpec(feature.specPath)).hash;
            this.returnToEngineering(state);
            return false;
        }

        const spec = await workspace.readSpec(feature.specPath);
        const context = `Current spec (${feature.specPath}, SHA-256 ${spec.hash}):\n${spec.text}`;
        if (state.stage === 'implement') {
            const report = await this.runRole(id, state, workspace, 'engineering',
                `Implement the current spec in the worktree, including code, images and Unity Prefabs as required. Keep the spec unchanged. Report files changed and verification steps.\n${context}`, signal, deadline);
            if (await workspace.head() !== feature.base) throw new Error('Engineering changed the feature branch HEAD');
            if ((await workspace.readSpec(feature.specPath)).hash !== spec.hash) {
                feature.implementation = undefined;
                return false;
            }
            feature.specHash = spec.hash;
            feature.implementation = report.summary;
            state.stage = 'qa';
            return false;
        }

        if (spec.hash !== feature.specHash) {
            this.returnToEngineering(state);
            return false;
        }
        const candidate = await workspace.snapshot(feature.base);
        await git(workspace.directory, 'cat-file', '-e', `${candidate}:${feature.specPath}`);
        const report = await this.runRole(id, state, workspace, 'qa',
            `Independently verify the candidate changes from ${feature.base} against every acceptance criterion. Use tests or the application, including image imports, Prefab references and Unity interactions when required. Do not modify feature files. Report verdict and per-criterion evidence. A missing or incorrect requirement is product_issue, a mismatch with a clear requirement is implementation_issue, and unavailable verification is blocked.\n${context}`, signal, deadline);
        const latestSpec = await workspace.readSpec(feature.specPath);
        if (latestSpec.hash !== spec.hash) {
            this.returnToEngineering(state);
            return false;
        }
        if (await workspace.snapshot(feature.base) !== candidate) throw new Error('Worktree changed during QA; resume to review the new changes');
        if (!report.verdict || !report.evidence?.length) throw new Error('QA did not provide a verdict and evidence');
        feature.review = report;
        if (report.verdict === 'pass') {
            if (candidate === await git(workspace.directory, 'rev-parse', 'HEAD^{tree}')) {
                throw new Error('No changes to commit for this feature');
            }
            feature.approvedTree = candidate;
            feature.approvedSpec = spec.hash;
            state.stage = 'commit';
            return false;
        }
        if (report.verdict === 'blocked') {
            state.lastError = report.summary;
            return true;
        }
        feature.revisions++;
        state.stage = report.verdict === 'product_issue' ? 'product' : 'implement';
        if (feature.revisions >= state.maxRevisions) {
            state.lastError = 'Feature Loop reached its revision limit';
            return true;
        }
        return false;
    }

    private async runRole(id: string, state: LoopState, workspace: FeatureLoopWorkspace, role: Role,
        instruction: string, signal: AbortSignal, deadline: number): Promise<Report> {
        const settings = state.roles[role];
        if (config.getAgent(settings.agentId).type !== AgentMode.Single) {
            throw new Error(`Feature Loop role "${settings.agentId}" must use Single mode`);
        }
        let report: Report | undefined;
        let attemptedTools = 0;
        const allowed = new Set([reportToolName, ...settings.tools]);
        const budget = new AbortController();
        const feature = state.feature;
        const threadId = `feature-loop-${id}-${feature?.id ?? 'planner'}-${role}`;
        await AgentRunner.run({
            agentId: settings.agentId,
            saverId: state.saverId,
            threadId,
            dbSessionId: threadId,
            workPath: workspace.directory,
            disableWorkspaceSkills: true,
            disableWorkspaceMcp: true,
            signal: AbortSignal.any([signal, budget.signal]),
            extraInfo: 'You are a role in an automated feature workflow. Work in the provided Git worktree. Never commit, change branches, push, or merge. The workflow handles Git publication. Use foreground commands with explicit timeoutMs and no detached child processes.',
            query: [`Goal: ${state.goal}`, feature && `Feature: ${feature.title}\nProposal: ${feature.proposal}`,
                feature?.implementation && `Implementation notes: ${feature.implementation}`,
                feature?.review && `Previous QA report: ${JSON.stringify(feature.review)}`,
                instruction, `Finish by calling ${reportToolName} with the result. Do not use tools after reporting.`]
                .filter(Boolean).join('\n\n'),
            callbacks: {
                toolNames: [...allowed],
                executeTool: async call => {
                    if (++attemptedTools > 120) budget.abort(new Error('Feature stage tool call limit exceeded'));
                    if (budget.signal.aborted || report || !allowed.has(call.name)) return ToolApproval.Deny;
                    if (call.name === 'exec_command') {
                        const timeout = call.args?.timeoutMs;
                        if (!Number.isInteger(timeout) || timeout <= 0 || Date.now() + timeout >= deadline) {
                            return ToolApproval.Deny;
                        }
                    }
                    return ToolApproval.Allow;
                },
            },
            agentTools: [createAgentTool({
                name: reportToolName,
                description: 'Report the final output of the current feature stage.',
                schema: reportSchema,
                func: async (value: Report) => {
                    if (report) throw new Error('This stage has already reported its result');
                    report = reportSchema.parse(value);
                    return 'Stage result recorded.';
                },
            })],
        });
        signal.throwIfAborted();
        budget.signal.throwIfAborted();
        if (!report) throw new Error(`The ${role} agent did not report a stage result`);
        return report;
    }
}

export const featureLoopService = new FeatureLoopService();
