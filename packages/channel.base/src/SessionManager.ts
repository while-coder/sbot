import { AgentToolCall, AskQuestionType, AskResponse, AskToolParams, ICancellationToken, ToolApproval } from "scorpio.ai";

export enum SessionStatus {
    Thinking = 'thinking',
    WaitingApproval = 'waiting_approval',
}

export interface AskInfo {
    id: string;
    threadId: string;
    title?: string;
    questions: AskToolParams['questions'];
    startedAt: Date;
}

export interface PendingToolInfo {
    tool: AgentToolCall;
    startedAt: Date;
}

export interface SessionInfo {
    threadId: string;
    startedAt: Date;
    status: SessionStatus;
    pendingTool?: PendingToolInfo;
    pendingAsk?: AskInfo;
}

class CancellationTokenSource implements ICancellationToken {
    private _isCancelled = false;
    get isCancelled() { return this._isCancelled; }
    cancel() { this._isCancelled = true; }
}

interface PendingAsk extends AskInfo {
    resolve: (answers: AskResponse) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}

interface SessionState {
    threadId: string;
    startedAt: Date;
    status: SessionStatus;
    pendingTool?: PendingToolInfo;
    source: CancellationTokenSource;
    pendingAsk?: PendingAsk;
    pendingApprovals: Map<string, (approval: ToolApproval) => void>;
}

class SessionManager {
    private sessions = new Map<string, SessionState>();
    private approvalIndex = new Map<string, string>(); // toolCallId → threadId

    start(threadId: string): ICancellationToken {
        const existing = this.sessions.get(threadId);
        if (existing) existing.source.cancel();
        const source = new CancellationTokenSource();
        this.sessions.set(threadId, {
            threadId,
            startedAt: new Date(),
            status: SessionStatus.Thinking,
            source,
            pendingApprovals: new Map(),
        });
        return source;
    }

    end(threadId: string): void {
        const session = this.sessions.get(threadId);
        if (!session) return;
        if (session.pendingAsk) {
            clearTimeout(session.pendingAsk.timer);
            session.pendingAsk.reject(new Error('Session ended'));
        }
        for (const [id, resolve] of session.pendingApprovals) {
            this.approvalIndex.delete(id);
            resolve(ToolApproval.Deny);
        }
        session.pendingApprovals.clear();
        this.sessions.delete(threadId);
    }

    registerToolApproval(threadId: string, id: string, resolve: (approval: ToolApproval) => void): void {
        const session = this.sessions.get(threadId);
        if (!session) return;
        session.pendingApprovals.set(id, resolve);
        this.approvalIndex.set(id, threadId);
    }

    resolveToolApproval(id: string, approval: ToolApproval): boolean {
        const threadId = this.approvalIndex.get(id);
        if (!threadId) return false;
        const session = this.sessions.get(threadId);
        const resolve = session?.pendingApprovals.get(id);
        if (!resolve) return false;
        session!.pendingApprovals.delete(id);
        this.approvalIndex.delete(id);
        resolve(approval);
        return true;
    }

    denyAllApprovals(threadId: string): void {
        const session = this.sessions.get(threadId);
        if (!session) return;
        for (const [id, resolve] of session.pendingApprovals) {
            this.approvalIndex.delete(id);
            resolve(ToolApproval.Deny);
        }
        session.pendingApprovals.clear();
    }

    cancel(threadId: string): boolean {
        const session = this.sessions.get(threadId);
        if (!session) return false;
        session.source.cancel();
        return true;
    }

    setStatus(threadId: string, status: SessionStatus, pendingTool?: AgentToolCall): void {
        const session = this.sessions.get(threadId);
        if (!session) return;
        session.status = status;
        session.pendingTool = pendingTool ? { tool: pendingTool, startedAt: new Date() } : undefined;
    }

    getInfo(threadId: string): SessionInfo | undefined {
        const s = this.sessions.get(threadId);
        if (!s) return undefined;
        return {
            threadId: s.threadId,
            startedAt: s.startedAt,
            status: s.status,
            pendingTool: s.pendingTool,
            pendingAsk: s.pendingAsk
                ? { id: s.pendingAsk.id, threadId: s.pendingAsk.threadId, title: s.pendingAsk.title, questions: s.pendingAsk.questions, startedAt: s.pendingAsk.startedAt }
                : undefined,
        };
    }

    isRunning(threadId: string): boolean {
        return this.sessions.has(threadId);
    }

    getAllInfo(): SessionInfo[] {
        return [...this.sessions.values()].map(s => ({
            threadId: s.threadId,
            startedAt: s.startedAt,
            status: s.status,
            pendingTool: s.pendingTool,
            pendingAsk: s.pendingAsk
                ? { id: s.pendingAsk.id, threadId: s.pendingAsk.threadId, title: s.pendingAsk.title, questions: s.pendingAsk.questions, startedAt: s.pendingAsk.startedAt }
                : undefined,
        }));
    }

    openAsk(threadId: string, params: AskToolParams, timeoutMs: number): { id: string; promise: Promise<AskResponse> } {
        const session = this.sessions.get(threadId);
        let resolve!: (answers: AskResponse) => void;
        let reject!: (err: Error) => void;
        const promise = new Promise<AskResponse>((res, rej) => { resolve = res; reject = rej; });
        const timer = setTimeout(() => {
            if (session) delete session.pendingAsk;
            reject(new Error('User did not answer within the allotted time'));
        }, timeoutMs);
        if (session) session.pendingAsk = { id: threadId, threadId, title: params.title, questions: params.questions, startedAt: new Date(), resolve, reject, timer };
        return { id: threadId, promise };
    }

    resolveAsk(threadId: string, answers: Record<string, string | string[] | boolean | undefined>): boolean {
        const session = this.sessions.get(threadId);
        if (!session?.pendingAsk) return false;
        clearTimeout(session.pendingAsk.timer);
        const labeledAnswers: AskResponse = {};
        const questions = session.pendingAsk.questions;
        for (let i = 0; i < questions.length; i++) {
            const q = questions[i];
            const raw = answers[String(i)];
            if (q.type === AskQuestionType.Toggle) {
                if (typeof raw === 'boolean') labeledAnswers[q.label] = String(raw);
                else if (Array.isArray(raw)) labeledAnswers[q.label] = raw.includes('true') ? 'true' : 'false';
                else labeledAnswers[q.label] = raw === 'true' ? 'true' : 'false';
            } else if (raw !== undefined) {
                labeledAnswers[q.label] = raw as string | string[];
            }
        }
        session.pendingAsk.resolve(labeledAnswers);
        delete session.pendingAsk;
        return true;
    }

    rejectAsk(threadId: string, message: string): void {
        const session = this.sessions.get(threadId);
        if (!session?.pendingAsk) return;
        clearTimeout(session.pendingAsk.timer);
        session.pendingAsk.reject(new Error(message));
        delete session.pendingAsk;
    }
}

export const sessionManager = new SessionManager();
