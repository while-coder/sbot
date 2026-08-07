import type { ChatMessage } from "scorpio.ai";
import type {
    MemoryRow,
    MemoryScope,
    MemorySearchHit,
    MemoryTarget,
    PendingMemoryJobRow,
} from "../Storage/IMemoryStore";
import type { IMemoryService, MemoryToolDescs } from "./IMemoryService";
import type { MemoryService } from "./MemoryService";

/**
 * 绑定 MemoryTarget 的轻量视图。Store、模型、队列和生命周期均由 owner 持有；
 * GlobalMemoryService / ScopedMemoryService 只负责固定调用作用域。
 */
export abstract class MemoryServiceView implements IMemoryService {
    protected constructor(
        protected readonly owner: MemoryService,
        protected readonly target: MemoryTarget,
    ) {}

    getSystemMessage(): Promise<string | null> {
        return this.owner.getSystemMessage(this.target);
    }

    readMemory(slug: string, scope: MemoryScope): Promise<MemoryRow | null> {
        return this.owner.readMemory(slug, scope, this.target);
    }

    search(query: string, limit?: number): Promise<MemorySearchHit[]> {
        return this.owner.search(query, limit, this.target);
    }

    remember(content: string, scope: MemoryScope): Promise<number> {
        return this.owner.remember(content, scope, this.target);
    }

    getToolDescs(): MemoryToolDescs {
        return this.owner.getToolDescs();
    }

    listAll(): Promise<MemoryRow[]> {
        return this.owner.listAll(this.target);
    }

    deleteMemory(slug: string, scope: MemoryScope): Promise<string> {
        return this.owner.deleteMemory(slug, scope, this.target);
    }

    extractFromConversation(messages: ChatMessage[]): void {
        this.owner.extractFromConversation(messages, this.target);
    }

    listPending(limit?: number): PendingMemoryJobRow[] {
        return this.owner.listPending(limit, this.target);
    }

    retryFailedJob(id: number): boolean {
        return this.owner.retryFailedJob(id, this.target);
    }

    deleteFailedJob(id: number): boolean {
        return this.owner.deleteFailedJob(id, this.target);
    }

    enqueueConsolidate(): number {
        return this.owner.enqueueConsolidate(this.target);
    }

    enqueueReconcile(): number {
        return this.owner.enqueueReconcile(this.target);
    }

    release(): void {
        this.owner.release();
    }
}
