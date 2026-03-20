import { AgentToolCall, ICancellationToken } from "scorpio.ai";

export enum SessionStatus {
    Thinking = 'thinking',
    WaitingApproval = 'waiting_approval',
}

export interface SessionInfo {
    threadId: string;
    startedAt: Date;
    status: SessionStatus;
    pendingTool?: AgentToolCall;
}

class CancellationTokenSource implements ICancellationToken {
    private _isCancelled = false;
    get isCancelled() { return this._isCancelled; }
    cancel() { this._isCancelled = true; }
}

interface SessionState extends SessionInfo {
    source: CancellationTokenSource;
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
        session.pendingTool = pendingTool;
    }

    getInfo(threadId: string): SessionInfo | undefined {
        const s = this.sessions.get(threadId);
        if (!s) return undefined;
        return { threadId: s.threadId, startedAt: s.startedAt, status: s.status, pendingTool: s.pendingTool };
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
        }));
    }
}

export const sessionManager = new SessionManager();
