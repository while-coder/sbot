import fs from "fs";
import path from "path";
import { ChatToolCall, ToolApproval, MessageDispatcher, type MessageContent } from "scorpio.ai";
import { type AskResponse, type AskToolParams } from "./AskTool";

export enum SessionStatus {
    Thinking = 'thinking',
    WaitingApproval = 'waiting_approval',
    WaitingAsk = 'waiting_ask',
}

export enum ApprovalTimeoutValue {
    Allow = 'allow',
    Deny  = 'deny',
}

export interface AskInfo {
    id: string;
    title?: string;
    questions: AskToolParams['questions'];
    startedAt: Date;
    /** 剩余秒数；0 表示无超时 */
    remainSec: number;
}

export interface ApprovalInfo {
    id: string;
    tool: ChatToolCall;
    startedAt: Date;
    /** 剩余秒数；0 表示无超时 */
    remainSec: number;
    /** 超时后默认动作；无超时时为 undefined */
    timeoutValue?: ApprovalTimeoutValue;
}

export interface SessionInfo {
    threadId: string;
    startedAt: Date;
    status: SessionStatus;
    pendingMessages: MessageContent[];
    pendingApproval?: ApprovalInfo;
    pendingAsk?: AskInfo;
}

// ── Internal pending interaction types ──

enum PendingType { Approval = 'approval', Ask = 'ask' }

interface PendingApprovalEntry {
    type: PendingType.Approval;
    id: string;
    startedAt: Date;
    timeoutAt: number;          // 0 表示无超时
    timeoutValue: ToolApproval;
    timer?: ReturnType<typeof setTimeout>;
    resolve: (approval: ToolApproval) => void;
    tool: ChatToolCall;
}

interface PendingAskEntry {
    type: PendingType.Ask;
    id: string;
    startedAt: Date;
    timeoutAt: number;          // 0 表示无超时
    timer?: ReturnType<typeof setTimeout>;
    resolve: (result: AskResponse | string) => void;
    title?: string;
    questions: AskToolParams['questions'];
}

type PendingEntry = PendingApprovalEntry | PendingAskEntry;

export interface SessionSettings {
    approveTools?: Record<string, string[]>;
}

export abstract class SessionService extends MessageDispatcher {
    readonly threadId: string;
    startedAt: Date;
    status: SessionStatus;
    private controller: AbortController;
    get signal(): AbortSignal { return this.controller.signal; }
    settings: SessionSettings = {};
    private settingsPath?: string;
    private pending: PendingEntry | null = null;

    constructor(threadId: string, settingsPath?: string) {
        super();
        this.threadId = threadId;
        this.startedAt = new Date();
        this.status = SessionStatus.Thinking;
        this.controller = new AbortController();
        this.settingsPath = settingsPath;
        if (settingsPath) {
            try { this.settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')); } catch {}
        }
    }

    saveSettings(): void {
        if (this.settingsPath) {
            fs.mkdirSync(path.dirname(this.settingsPath), { recursive: true });
            fs.writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2), 'utf-8');
        }
    }

    // ── Status ──

    private _syncStatus(): void {
        if (!this.pending) this.status = SessionStatus.Thinking;
        else if (this.pending.type === PendingType.Approval) this.status = SessionStatus.WaitingApproval;
        else this.status = SessionStatus.WaitingAsk;
    }

    getInfo(): SessionInfo {
        const p = this.pending;
        const computeRemainSec = (timeoutAt: number): number =>
            timeoutAt > 0 ? Math.max(0, Math.ceil((timeoutAt - Date.now()) / 1000)) : 0;
        return {
            threadId: this.threadId,
            startedAt: this.startedAt,
            status: this.status,
            pendingApproval: p?.type === PendingType.Approval
                ? {
                    id: p.id, tool: p.tool, startedAt: p.startedAt,
                    remainSec: computeRemainSec(p.timeoutAt),
                    timeoutValue: p.timeoutAt > 0 ? (p.timeoutValue === ToolApproval.Allow ? ApprovalTimeoutValue.Allow : ApprovalTimeoutValue.Deny) : undefined,
                }
                : undefined,
            pendingAsk: p?.type === PendingType.Ask
                ? {
                    id: p.id, title: p.title, questions: p.questions, startedAt: p.startedAt,
                    remainSec: computeRemainSec(p.timeoutAt),
                }
                : undefined,
            pendingMessages: this.messageQueue.map(m => m.query),
        };
    }

    // ── Approval ──

    enterApproval(toolCall: ChatToolCall, timeoutMs: number, timeoutValue: ToolApproval): { id: string; promise: Promise<ToolApproval> } {
        this.cancelPending();
        const id = `tc-${Date.now()}`;
        let resolve!: (approval: ToolApproval) => void;
        const promise = new Promise<ToolApproval>((res) => { resolve = res; });
        const timer = timeoutMs > 0 ? setTimeout(() => {
            if (this.pending?.id === id) {
                this.pending = null;
                this._syncStatus();
            }
            resolve(timeoutValue);
        }, timeoutMs) : undefined;
        const timeoutAt = timeoutMs > 0 ? Date.now() + timeoutMs : 0;
        this.pending = { type: PendingType.Approval, id, tool: toolCall, startedAt: new Date(), timeoutAt, timeoutValue, resolve, timer };
        this._syncStatus();
        return { id, promise };
    }

    exitApproval(id: string, approval: ToolApproval): boolean {
        const p = this.pending;
        if (!p || p.type !== PendingType.Approval || p.id !== id) return false;
        clearTimeout(p.timer);
        this.pending = null;
        this._syncStatus();
        p.resolve(approval);
        return true;
    }

    exitAllApprovals(): void {
        const p = this.pending;
        if (p?.type === PendingType.Approval) {
            clearTimeout(p.timer);
            this.pending = null;
            this._syncStatus();
            p.resolve(ToolApproval.Deny);
        }
    }

    // ── Ask ──

    enterAsk(params: AskToolParams, timeoutMs: number, timeoutMessage: string): { id: string; promise: Promise<AskResponse> } {
        this.cancelPending();
        const id = `ask-${Date.now()}`;
        let resolve!: (result: AskResponse | string) => void;
        const promise = new Promise<AskResponse>((res, rej) => {
            resolve = (result) => typeof result === 'string' ? rej(new Error(result)) : res(result);
        });
        const timer = timeoutMs > 0 ? setTimeout(() => {
            if (this.pending?.id === id) {
                this.pending = null;
                this._syncStatus();
            }
            resolve(timeoutMessage);
        }, timeoutMs) : undefined;
        const timeoutAt = timeoutMs > 0 ? Date.now() + timeoutMs : 0;
        this.pending = { type: PendingType.Ask, id, title: params.title, questions: params.questions, startedAt: new Date(), timeoutAt, resolve, timer };
        this._syncStatus();
        return { id, promise };
    }

    exitAsk(id: string, result: Record<string, string | string[] | boolean | undefined> | string): boolean {
        const p = this.pending;
        if (!p || p.type !== PendingType.Ask || p.id !== id) return false;
        clearTimeout(p.timer);
        this.pending = null;
        this._syncStatus();
        if (typeof result === 'string') {
            p.resolve(result);
        } else {
            const labeledAnswers: AskResponse = {};
            for (let i = 0; i < p.questions.length; i++) {
                const q = p.questions[i];
                const raw = result[String(i)];
                if (raw !== undefined) {
                    labeledAnswers[q.label] = raw as string | string[];
                }
            }
            p.resolve(labeledAnswers);
        }
        return true;
    }

    exitAllAsks(message: string): void {
        const p = this.pending;
        if (p?.type === PendingType.Ask) {
            clearTimeout(p.timer);
            this.pending = null;
            this._syncStatus();
            p.resolve(message);
        }
    }

    // ── Cleanup ──

    /** Cancel any pending approval or ask. */
    private cancelPending(): void {
        const p = this.pending;
        if (!p) return;
        clearTimeout(p.timer);
        this.pending = null;
        if (p.type === PendingType.Approval) p.resolve(ToolApproval.Deny);
        else p.resolve('Cancelled by new interaction');
        this._syncStatus();
    }

    /** Cancel the session and prepare a fresh signal for the next cycle. */
    abort(): void {
        this.cancelPending();
        this.controller.abort();
        this.controller = new AbortController();
    }

    cleanup(): void {
        this.cancelPending();
    }
}
