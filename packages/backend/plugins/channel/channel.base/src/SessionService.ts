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
//
// 审批/询问统一进一条 FIFO 交互队列：同一时刻只有队首 entry 处于 active（展示给用户）。
// 这样主 agent 与子 agent（共享同一 session 的 callback.executeTool）并发触发的审批/询问
// 会被串行化，用户逐个点击；批准/回答后立即提升下一个队首。计时从“成为 active（展示）”起算。

enum PendingType { Approval = 'approval', Ask = 'ask' }

interface PendingApprovalEntry {
    type: PendingType.Approval;
    id: string;
    startedAt: Date;            // 成为 active 的时刻（展示才计）
    timeoutMs: number;          // 0 表示无超时
    timeoutAt: number;          // active 后才设；0 表示未计时/无超时
    timeoutValue: ToolApproval;
    timer?: ReturnType<typeof setTimeout>;
    resolve: (approval: ToolApproval) => void;
    /** 成为队首 active 时触发（推 UI）。入队但未展示时不调用。 */
    onActivate?: (id: string, remainSec: number) => void;
    tool: ChatToolCall;
}

interface PendingAskEntry {
    type: PendingType.Ask;
    id: string;
    startedAt: Date;
    timeoutMs: number;
    timeoutAt: number;
    timeoutMessage: string;
    timer?: ReturnType<typeof setTimeout>;
    resolve: (result: AskResponse | string) => void;
    onActivate?: (id: string, remainSec: number) => void;
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
    /** 当前展示给用户的交互（队首）；同一时刻最多一个。 */
    private active: PendingEntry | null = null;
    /** 等待展示的交互，FIFO。 */
    private queue: PendingEntry[] = [];
    /** 单调递增序号，保证并发入队时 id 唯一（Date.now() 同毫秒会撞）。 */
    private seq = 0;

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
        if (!this.active) this.status = SessionStatus.Thinking;
        else if (this.active.type === PendingType.Approval) this.status = SessionStatus.WaitingApproval;
        else this.status = SessionStatus.WaitingAsk;
    }

    getInfo(): SessionInfo {
        const p = this.active;
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

    // ── Queue scheduling ──

    /** 把队首提升为 active：开始计时（展示才计）并推 UI。已有 active 时不动。 */
    private _activateNext(): void {
        if (this.active) return;
        const next = this.queue.shift();
        if (!next) { this._syncStatus(); return; }
        this.active = next;
        next.startedAt = new Date();
        if (next.timeoutMs > 0) {
            next.timeoutAt = Date.now() + next.timeoutMs;
            next.timer = setTimeout(() => this._onTimeout(next), next.timeoutMs);
        }
        this._syncStatus();
        const remainSec = next.timeoutMs > 0 ? Math.floor(next.timeoutMs / 1000) : 0;
        // microtask 化：默认 channel 的 enterApproval 会同步 resolve，避免 activate→resolve→activate 同步递归爆栈
        queueMicrotask(() => { try { next.onActivate?.(next.id, remainSec); } catch {} });
    }

    private _onTimeout(entry: PendingEntry): void {
        if (this.active?.id !== entry.id) return;
        clearTimeout(entry.timer);
        this.active = null;
        if (entry.type === PendingType.Approval) entry.resolve(entry.timeoutValue);
        else entry.resolve(entry.timeoutMessage);
        this._activateNext();
    }

    /** 从 active 或队列中按 id 取出一个 entry（并清掉其 timer / active 引用）。 */
    private _take(id: string, type: PendingType): PendingEntry | null {
        if (this.active && this.active.id === id && this.active.type === type) {
            const e = this.active;
            clearTimeout(e.timer);
            this.active = null;
            return e;
        }
        const idx = this.queue.findIndex(e => e.id === id && e.type === type);
        if (idx >= 0) {
            const [e] = this.queue.splice(idx, 1);
            clearTimeout(e.timer);
            return e;
        }
        return null;
    }

    // ── Approval ──

    enterApproval(
        toolCall: ChatToolCall,
        timeoutMs: number,
        timeoutValue: ToolApproval,
        onActivate?: (id: string, remainSec: number) => void,
    ): { id: string; promise: Promise<ToolApproval> } {
        const id = `tc-${Date.now()}-${++this.seq}`;
        let resolve!: (approval: ToolApproval) => void;
        const promise = new Promise<ToolApproval>((res) => { resolve = res; });
        const entry: PendingApprovalEntry = {
            type: PendingType.Approval, id, tool: toolCall,
            startedAt: new Date(), timeoutMs, timeoutAt: 0, timeoutValue, resolve, onActivate,
        };
        this.queue.push(entry);
        this._activateNext();
        return { id, promise };
    }

    exitApproval(id: string, approval: ToolApproval): boolean {
        const e = this._take(id, PendingType.Approval);
        if (!e) return false;
        (e as PendingApprovalEntry).resolve(approval);
        this._activateNext();
        return true;
    }

    exitAllApprovals(): void {
        const entries = [this.active, ...this.queue]
            .filter((e): e is PendingApprovalEntry => e?.type === PendingType.Approval);
        for (const e of entries) this._take(e.id, PendingType.Approval);
        for (const e of entries) e.resolve(ToolApproval.Deny);
        this._activateNext();
    }

    // ── Ask ──

    enterAsk(
        params: AskToolParams,
        timeoutMs: number,
        timeoutMessage: string,
        onActivate?: (id: string, remainSec: number) => void,
    ): { id: string; promise: Promise<AskResponse> } {
        const id = `ask-${Date.now()}-${++this.seq}`;
        let resolve!: (result: AskResponse | string) => void;
        const promise = new Promise<AskResponse>((res, rej) => {
            resolve = (result) => typeof result === 'string' ? rej(new Error(result)) : res(result);
        });
        const entry: PendingAskEntry = {
            type: PendingType.Ask, id, title: params.title, questions: params.questions,
            startedAt: new Date(), timeoutMs, timeoutAt: 0, timeoutMessage, resolve, onActivate,
        };
        this.queue.push(entry);
        this._activateNext();
        return { id, promise };
    }

    exitAsk(id: string, result: Record<string, string | string[] | boolean | undefined> | string): boolean {
        const e = this._take(id, PendingType.Ask);
        if (!e) return false;
        const entry = e as PendingAskEntry;
        if (typeof result === 'string') {
            entry.resolve(result);
        } else {
            const labeledAnswers: AskResponse = {};
            for (let i = 0; i < entry.questions.length; i++) {
                const q = entry.questions[i];
                const raw = result[String(i)];
                if (raw !== undefined) {
                    labeledAnswers[q.label] = raw as string | string[];
                }
            }
            entry.resolve(labeledAnswers);
        }
        this._activateNext();
        return true;
    }

    exitAllAsks(message: string): void {
        const entries = [this.active, ...this.queue]
            .filter((e): e is PendingAskEntry => e?.type === PendingType.Ask);
        for (const e of entries) this._take(e.id, PendingType.Ask);
        for (const e of entries) e.resolve(message);
        this._activateNext();
    }

    // ── Cleanup ──

    /** 取消所有 pending（active + 队列）：审批 Deny、询问按取消处理。 */
    private cancelAll(): void {
        const all = [this.active, ...this.queue].filter((e): e is PendingEntry => !!e);
        this.active = null;
        this.queue = [];
        for (const e of all) {
            clearTimeout(e.timer);
            if (e.type === PendingType.Approval) e.resolve(ToolApproval.Deny);
            else e.resolve('Cancelled by new interaction');
        }
        this._syncStatus();
    }

    /** Cancel the session and prepare a fresh signal for the next cycle. */
    abort(): void {
        this.cancelAll();
        this.controller.abort();
        this.controller = new AbortController();
    }

    cleanup(): void {
        this.cancelAll();
    }
}
