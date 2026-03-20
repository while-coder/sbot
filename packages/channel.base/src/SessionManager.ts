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

interface PendingApproval {
    resolve: (approval: ToolApproval) => void;
    timer: ReturnType<typeof setTimeout>;
}

interface SessionState {
    threadId: string;
    startedAt: Date;
    status: SessionStatus;
    pendingTool?: PendingToolInfo;
    source: CancellationTokenSource;
    pendingAsks: Map<string, PendingAsk>;
    pendingApprovals: Map<string, PendingApproval>;
}

class SessionManager {
    private sessions = new Map<string, SessionState>();

    start(threadId: string): ICancellationToken {
        const existing = this.sessions.get(threadId);
        if (existing) existing.source.cancel();
        const source = new CancellationTokenSource();
        this.sessions.set(threadId, {
            threadId,
            startedAt: new Date(),
            status: SessionStatus.Thinking,
            source,
            pendingAsks: new Map(),
            pendingApprovals: new Map(),
        });
        return source;
    }

    end(threadId: string): void {
        const session = this.sessions.get(threadId);
        if (!session) return;
        for (const [, ask] of session.pendingAsks) {
            clearTimeout(ask.timer);
            ask.reject(new Error('Session ended'));
        }
        session.pendingAsks.clear();
        for (const [, entry] of session.pendingApprovals) {
            clearTimeout(entry.timer);
            entry.resolve(ToolApproval.Deny);
        }
        session.pendingApprovals.clear();
        this.sessions.delete(threadId);
    }

    enterToolApproval(threadId: string, resolve: (approval: ToolApproval) => void, timeoutMs: number): string {
        const session = this.sessions.get(threadId);
        if (!session) return '';
        let id = `tc-${Date.now()}`;
        while (session.pendingApprovals.has(id)) id = `tc-${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const timer = setTimeout(() => this.exitToolApproval(threadId, id, ToolApproval.Deny), timeoutMs);
        session.pendingApprovals.set(id, { resolve, timer });
        return id;
    }

    exitToolApproval(threadId: string, id: string, approval: ToolApproval): boolean {
        const session = this.sessions.get(threadId);
        const entry = session?.pendingApprovals.get(id);
        if (!entry) return false;
        clearTimeout(entry.timer);
        session!.pendingApprovals.delete(id);
        entry.resolve(approval);
        return true;
    }

    exitAllApprovals(threadId: string): void {
        const session = this.sessions.get(threadId);
        if (!session) return;
        for (const [, entry] of session.pendingApprovals) {
            clearTimeout(entry.timer);
            entry.resolve(ToolApproval.Deny);
        }
        session.pendingApprovals.clear();
    }

    abort(threadId: string): boolean {
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
        const firstAsk = s.pendingAsks.values().next().value as PendingAsk | undefined;
        return {
            threadId: s.threadId,
            startedAt: s.startedAt,
            status: s.status,
            pendingTool: s.pendingTool,
            pendingAsk: firstAsk
                ? { id: firstAsk.id, threadId: firstAsk.threadId, title: firstAsk.title, questions: firstAsk.questions, startedAt: firstAsk.startedAt }
                : undefined,
        };
    }

    isRunning(threadId: string): boolean {
        return this.sessions.has(threadId);
    }

    getAllInfo(): SessionInfo[] {
        return [...this.sessions.values()].map(s => {
            const firstAsk = s.pendingAsks.values().next().value as PendingAsk | undefined;
            return {
                threadId: s.threadId,
                startedAt: s.startedAt,
                status: s.status,
                pendingTool: s.pendingTool,
                pendingAsk: firstAsk
                    ? { id: firstAsk.id, threadId: firstAsk.threadId, title: firstAsk.title, questions: firstAsk.questions, startedAt: firstAsk.startedAt }
                    : undefined,
            };
        });
    }

    enterAsk(threadId: string, params: AskToolParams, timeoutMs: number): { id: string; promise: Promise<AskResponse> } {
        const session = this.sessions.get(threadId);
        if (!session) return { id: '', promise: Promise.reject(new Error('Session not found')) };
        let id = `ask-${Date.now()}`;
        while (session.pendingAsks.has(id)) id = `ask-${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        let resolve!: (answers: AskResponse) => void;
        let reject!: (err: Error) => void;
        const promise = new Promise<AskResponse>((res, rej) => { resolve = res; reject = rej; });
        const timer = setTimeout(() => {
            session.pendingAsks.delete(id);
            reject(new Error('User did not answer within the allotted time'));
        }, timeoutMs);
        session.pendingAsks.set(id, { id, threadId, title: params.title, questions: params.questions, startedAt: new Date(), resolve, reject, timer });
        return { id, promise };
    }

    /** 成功传 answers 对象，失败传错误消息字符串 */
    exitAsk(threadId: string, id: string, result: Record<string, string | string[] | boolean | undefined> | string): boolean {
        const session = this.sessions.get(threadId);
        const ask = session?.pendingAsks.get(id);
        if (!ask) return false;
        clearTimeout(ask.timer);
        session!.pendingAsks.delete(id);
        if (typeof result === 'string') {
            ask.reject(new Error(result));
        } else {
            const labeledAnswers: AskResponse = {};
            for (let i = 0; i < ask.questions.length; i++) {
                const q = ask.questions[i];
                const raw = result[String(i)];
                if (q.type === AskQuestionType.Toggle) {
                    if (typeof raw === 'boolean') labeledAnswers[q.label] = String(raw);
                    else if (Array.isArray(raw)) labeledAnswers[q.label] = raw.includes('true') ? 'true' : 'false';
                    else labeledAnswers[q.label] = raw === 'true' ? 'true' : 'false';
                } else if (raw !== undefined) {
                    labeledAnswers[q.label] = raw as string | string[];
                }
            }
            ask.resolve(labeledAnswers);
        }
        return true;
    }

    exitAllAsks(threadId: string, message: string): void {
        const session = this.sessions.get(threadId);
        if (!session) return;
        for (const [, ask] of session.pendingAsks) {
            clearTimeout(ask.timer);
            ask.reject(new Error(message));
        }
        session.pendingAsks.clear();
    }
}

export const sessionManager = new SessionManager();
