import { AgentToolCall, AskResponse, AskToolParams, ICancellationToken, ToolApproval } from "scorpio.ai";
import { AskInfo, ApprovalInfo, SessionStatus } from './SessionManager';

export class CancellationTokenSource implements ICancellationToken {
    private _isCancelled = false;
    get isCancelled() { return this._isCancelled; }
    cancel() { this._isCancelled = true; }
}

export interface PendingAsk extends AskInfo {
    resolve: (result: AskResponse | string) => void;
    timer: ReturnType<typeof setTimeout>;
}

export interface PendingApproval extends ApprovalInfo {
    resolve: (approval: ToolApproval) => void;
    timer: ReturnType<typeof setTimeout>;
}

export interface SessionService {
    threadId: string;
    startedAt: Date;
    status: SessionStatus;
    source: CancellationTokenSource;
    pendingAsks: Map<string, PendingAsk>;
    pendingApprovals: Map<string, PendingApproval>;
}
