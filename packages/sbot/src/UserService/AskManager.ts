import { AskResponse, AskToolParams } from "scorpio.ai";

export interface AskInfo {
    id: string;
    threadId: string;
    title?: string;
    questions: AskToolParams['questions'];
}

interface AskEntry extends AskInfo {
    resolve: (answers: AskResponse) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}

class AskManager {
    private pending = new Map<string, AskEntry>();

    open(threadId: string, params: AskToolParams, timeoutMs: number): { id: string; promise: Promise<AskResponse> } {
        const id = `ask_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        let resolve!: (answers: AskResponse) => void;
        let reject!: (err: Error) => void;
        const promise = new Promise<AskResponse>((res, rej) => { resolve = res; reject = rej; });
        const timer = setTimeout(() => {
            this.pending.delete(id);
            reject(new Error('User did not answer within the allotted time'));
        }, timeoutMs);
        this.pending.set(id, { id, threadId, title: params.title, questions: params.questions, resolve, reject, timer });
        return { id, promise };
    }

    resolve(id: string, answers: AskResponse): boolean {
        const entry = this.pending.get(id);
        if (!entry) return false;
        clearTimeout(entry.timer);
        this.pending.delete(id);
        entry.resolve(answers);
        return true;
    }

    /** 拒绝指定 threadId 的所有挂起 ask（连接断开时使用） */
    rejectByThreadId(threadId: string, message: string): void {
        for (const [id, entry] of this.pending) {
            if (entry.threadId !== threadId) continue;
            clearTimeout(entry.timer);
            this.pending.delete(id);
            entry.reject(new Error(message));
        }
    }

    getByThreadId(threadId: string): AskInfo | undefined {
        for (const entry of this.pending.values()) {
            if (entry.threadId === threadId)
                return { id: entry.id, threadId: entry.threadId, title: entry.title, questions: entry.questions };
        }
        return undefined;
    }
}

export const askManager = new AskManager();
