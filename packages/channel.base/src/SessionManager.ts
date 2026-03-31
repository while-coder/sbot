import { AgentToolCall, AskResponse, AskToolParams, ToolApproval } from "scorpio.ai";
import { SessionService, SessionInfo } from './SessionService';

export abstract class SessionManager {
    private sessions = new Map<string, SessionService>();

    /** 子类实现：创建具体的 SessionService 实例 */
    protected abstract createSession(threadId: string): SessionService;

    /** 获取已有 session（不创建） */
    protected getSession(threadId: string): SessionService | undefined {
        return this.sessions.get(threadId);
    }

    /** 获取已有 session 或创建新的（若已有则先取消再重建） */
    getOrCreate(threadId: string): SessionService {
        const existing = this.sessions.get(threadId);
        if (existing) existing.source.cancel();
        const session = this.createSession(threadId);
        this.sessions.set(threadId, session);
        return session;
    }

    end(threadId: string): void {
        const session = this.sessions.get(threadId);
        if (!session) return;
        session.cleanup();
        this.sessions.delete(threadId);
    }

    abort(threadId: string): boolean {
        const session = this.sessions.get(threadId);
        if (!session) return false;
        session.source.cancel();
        return true;
    }

    isRunning(threadId: string): boolean {
        return this.sessions.has(threadId);
    }

    getInfo(threadId: string): SessionInfo | undefined {
        return this.sessions.get(threadId)?.getInfo();
    }

    getAllInfo(): SessionInfo[] {
        return [...this.sessions.values()].map(s => s.getInfo());
    }

    // ── Delegation to session (by threadId) ──

    enterApproval(threadId: string, toolCall: AgentToolCall, timeoutMs: number): { id: string; promise: Promise<ToolApproval> } {
        const session = this.sessions.get(threadId);
        if (!session) return { id: '', promise: Promise.reject(new Error('Session not found')) };
        return session.enterApproval(toolCall, timeoutMs);
    }

    exitApproval(threadId: string, id: string, approval: ToolApproval): boolean {
        const session = this.sessions.get(threadId);
        if (!session) return false;
        return session.exitApproval(id, approval);
    }

    exitAllApprovals(threadId: string): void {
        this.sessions.get(threadId)?.exitAllApprovals();
    }

    enterAsk(threadId: string, params: AskToolParams, timeoutMs: number): { id: string; promise: Promise<AskResponse> } {
        const session = this.sessions.get(threadId);
        if (!session) return { id: '', promise: Promise.reject(new Error('Session not found')) };
        return session.enterAsk(params, timeoutMs);
    }

    exitAsk(threadId: string, id: string, result: Record<string, string | string[] | boolean | undefined> | string): boolean {
        const session = this.sessions.get(threadId);
        if (!session) return false;
        return session.exitAsk(id, result);
    }

    exitAllAsks(threadId: string, message: string): void {
        this.sessions.get(threadId)?.exitAllAsks(message);
    }

}
