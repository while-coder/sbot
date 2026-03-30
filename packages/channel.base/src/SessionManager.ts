import { AgentToolCall, AskQuestionType, AskResponse, AskToolParams, ICancellationToken, ToolApproval } from "scorpio.ai";
import { CancellationTokenSource, PendingAsk, PendingApproval, SessionService } from './SessionService';

export enum SessionStatus {
    Thinking = 'thinking',
    WaitingApproval = 'waiting_approval',
    WaitingAsk = 'waiting_ask',
}

export interface AskInfo {
    id: string;
    title?: string;
    questions: AskToolParams['questions'];
    startedAt: Date;
}

export interface ApprovalInfo {
    id: string;
    tool: AgentToolCall;
    startedAt: Date;
}

export interface SessionInfo {
    threadId: string;
    startedAt: Date;
    status: SessionStatus;
    pendingApproval?: ApprovalInfo;
    pendingAsk?: AskInfo;
}

class SessionManager {
    private sessions = new Map<string, SessionService>();

    private _syncStatus(session: SessionService): void {
        if (session.pendingApprovals.size > 0) session.status = SessionStatus.WaitingApproval;
        else if (session.pendingAsks.size > 0) session.status = SessionStatus.WaitingAsk;
        else session.status = SessionStatus.Thinking;
    }

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
            ask.resolve('Session ended');
        }
        session.pendingAsks.clear();
        for (const [, entry] of session.pendingApprovals) {
            clearTimeout(entry.timer);
            entry.resolve(ToolApproval.Deny);
        }
        session.pendingApprovals.clear();
        this.sessions.delete(threadId);
    }

    enterApproval(threadId: string, toolCall: AgentToolCall, timeoutMs: number): { id: string; promise: Promise<ToolApproval> } {
        const session = this.sessions.get(threadId);
        if (!session) return { id: '', promise: Promise.reject(new Error('Session not found')) };
        let id = `tc-${Date.now()}`;
        while (session.pendingApprovals.has(id)) id = `tc-${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        let resolve!: (approval: ToolApproval) => void;
        const promise = new Promise<ToolApproval>((res) => { resolve = res; });
        const timer = setTimeout(() => {
            session.pendingApprovals.delete(id);
            this._syncStatus(session);
            resolve(ToolApproval.Deny);
        }, timeoutMs);
        session.pendingApprovals.set(id, { id, tool: toolCall, startedAt: new Date(), resolve, timer });
        this._syncStatus(session);
        return { id, promise };
    }

    exitApproval(threadId: string, id: string, approval: ToolApproval): boolean {
        const session = this.sessions.get(threadId);
        const entry = session?.pendingApprovals.get(id);
        if (!entry) return false;
        clearTimeout(entry.timer);
        session!.pendingApprovals.delete(id);
        this._syncStatus(session!);
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
        this._syncStatus(session);
    }

    abort(threadId: string): boolean {
        const session = this.sessions.get(threadId);
        if (!session) return false;
        session.source.cancel();
        return true;
    }

    getInfo(threadId: string): SessionInfo | undefined {
        const s = this.sessions.get(threadId);
        if (!s) return undefined;
        const firstApproval = s.pendingApprovals.values().next().value as PendingApproval | undefined;
        const firstAsk = s.pendingAsks.values().next().value as PendingAsk | undefined;
        return {
            threadId: s.threadId,
            startedAt: s.startedAt,
            status: s.status,
            pendingApproval: firstApproval && { id: firstApproval.id, tool: firstApproval.tool, startedAt: firstApproval.startedAt },
            pendingAsk: firstAsk && { id: firstAsk.id, title: firstAsk.title, questions: firstAsk.questions, startedAt: firstAsk.startedAt },
        };
    }

    isRunning(threadId: string): boolean {
        return this.sessions.has(threadId);
    }

    getAllInfo(): SessionInfo[] {
        return [...this.sessions.values()].map(s => {
            const firstApproval = s.pendingApprovals.values().next().value as PendingApproval | undefined;
            const firstAsk = s.pendingAsks.values().next().value as PendingAsk | undefined;
            return {
                threadId: s.threadId,
                startedAt: s.startedAt,
                status: s.status,
                pendingApproval: firstApproval && { id: firstApproval.id, tool: firstApproval.tool, startedAt: firstApproval.startedAt },
                pendingAsk: firstAsk && { id: firstAsk.id, title: firstAsk.title, questions: firstAsk.questions, startedAt: firstAsk.startedAt },
            };
        });
    }

    enterAsk(threadId: string, params: AskToolParams, timeoutMs: number): { id: string; promise: Promise<AskResponse> } {
        const session = this.sessions.get(threadId);
        if (!session) return { id: '', promise: Promise.reject(new Error('Session not found')) };
        let id = `ask-${Date.now()}`;
        while (session.pendingAsks.has(id)) id = `ask-${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        let resolve!: (result: AskResponse | string) => void;
        const promise = new Promise<AskResponse>((res, rej) => {
            resolve = (result) => typeof result === 'string' ? rej(new Error(result)) : res(result);
        });
        const timer = setTimeout(() => {
            session.pendingAsks.delete(id);
            this._syncStatus(session);
            resolve('User did not answer within the allotted time');
        }, timeoutMs);
        session.pendingAsks.set(id, { id, title: params.title, questions: params.questions, startedAt: new Date(), resolve, timer });
        this._syncStatus(session);
        return { id, promise };
    }

    /** 成功传 answers 对象，失败传错误消息字符串 */
    exitAsk(threadId: string, id: string, result: Record<string, string | string[] | boolean | undefined> | string): boolean {
        const session = this.sessions.get(threadId);
        const ask = session?.pendingAsks.get(id);
        if (!ask) return false;
        clearTimeout(ask.timer);
        session!.pendingAsks.delete(id);
        this._syncStatus(session!);
        if (typeof result === 'string') {
            ask.resolve(result);
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
            ask.resolve(message);
        }
        session.pendingAsks.clear();
        this._syncStatus(session);
    }
}

export const sessionManager = new SessionManager();
