import { inject } from "../../Core";
import { Memory } from "../types";
import { IMemoryService } from "./IMemoryService";

/**
 * 只读记忆服务（装饰器模式）
 * 代理内部 IMemoryService 的读取操作，
 * 写入操作（memorizeConversation / addMemoryDirect）为空操作。
 * 用于 mode = read_only 的场景。
 */
export class ReadOnlyMemoryService implements IMemoryService {
    constructor(private readonly inner: IMemoryService) {}

    // ── 读取 ──────────────────────────────────────────────────────────────────

    getSystemMessage(query: string, limit?: number): Promise<string | null> { return this.inner.getSystemMessage(query, limit); }

    getAllMemories(): Promise<Memory[]> { return this.inner.getAllMemories(); }

    // ── 写入（只读模式下为空操作）────────────────────────────────────────────

    async memorizeConversation(): Promise<void> {}

    async addMemoryDirect(_content: string): Promise<string[]> { return []; }

    // ── 维护 ──────────────────────────────────────────────────────────────────

    async deleteMemory(memoryId: string): Promise<void> { }

    async compressMemories(): Promise<number> { return 0; }

    async clearAll(): Promise<number> { return 0; }

    // ── 生命周期 ──────────────────────────────────────────────────────────────

    async dispose(): Promise<void> { }
}
