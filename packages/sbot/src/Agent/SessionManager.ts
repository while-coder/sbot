import { AgentToolCall, AskResponse, AskToolParams, ICancellationToken } from "scorpio.ai";

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
}

class SessionManager {
    private sessions = new Map<string, SessionState>();

    /**
     * 注册一个新 session，返回其 CancellationToken。
     * 若该 threadId 已有运行中的 session，先取消它。
     */
    start(threadId: string): ICancellationToken {
        const existing = this.sessions.get(threadId);
        if (existing) existing.source.cancel();

        const source = new CancellationTokenSource();
        this.sessions.set(threadId, {
            threadId,
            startedAt: new Date(),
            status: SessionStatus.Thinking,
            source,
        });
        return source;
    }

    /** session 结束后移除（无论成功、取消还是报错）。 */
    end(threadId: string): void {
        const session = this.sessions.get(threadId);
        if (session?.pendingAsk) {
            clearTimeout(session.pendingAsk.timer);
            session.pendingAsk.reject(new Error('Session ended'));
        }
        this.sessions.delete(threadId);
    }

    /** 取消指定 threadId 的 session，若不存在返回 false。 */
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

    resolveAsk(threadId: string, answers: AskResponse): boolean {
        const session = this.sessions.get(threadId);
        if (!session?.pendingAsk) return false;
        clearTimeout(session.pendingAsk.timer);
        session.pendingAsk.resolve(answers);
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
