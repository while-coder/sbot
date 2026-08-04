import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
    MemoryScope,
    type IMemoryStore,
    type MemoryWorkspaceScope,
} from "../Storage/IMemoryStore";
import { MemoryStore } from "../Storage/MemoryStore";
import type { MemoryService } from "./MemoryService";
import { MemoryServiceView } from "./MemoryServiceView";

export const WORKSPACE_MEMORY_DIR = 'workspaces';
export const WORKSPACE_MEMORY_META_FILE = 'scope.json';

/**
 * 按规范化 workPath 缓存的工作区记忆服务。它持有该工作区唯一的 Store 与 reconcile
 * Promise；模型、任务队列和引用计数仍由按 memoryId 唯一的 MemoryService owner 管理。
 * release 与 pool.acquire 的 owner ref 配对，dispose 仅由 owner teardown 调用。
 */
export class ScopedMemoryService extends MemoryServiceView {
    readonly store: IMemoryStore;
    private reconcilePromise: Promise<{ indexed: number; pruned: number }> | null = null;
    private disposed = false;

    constructor(
        owner: MemoryService,
        readonly workspace: MemoryWorkspaceScope,
        memoryRootDir: string,
    ) {
        super(owner, { scope: MemoryScope.Workspace, workspace });

        const rootDir = path.join(memoryRootDir, WORKSPACE_MEMORY_DIR, workspace.key);
        mkdirSync(rootDir, { recursive: true });
        const metaPath = path.join(rootDir, WORKSPACE_MEMORY_META_FILE);
        if (!existsSync(metaPath)) {
            writeFileSync(metaPath, JSON.stringify({ key: workspace.key, path: workspace.path }, null, 2) + '\n', 'utf8');
        }
        this.store = new MemoryStore(rootDir, path.join(rootDir, 'memory.db'));
    }

    get hasReconciled(): boolean {
        return this.reconcilePromise !== null;
    }

    reconcile(force: boolean): Promise<{ indexed: number; pruned: number }> {
        if (this.disposed) throw new Error(`Workspace memory service already disposed: ${this.workspace.path}`);
        const current = this.reconcilePromise;
        if (current && !force) return current;

        const next = (async () => {
            if (current) await current.catch(() => {});
            return this.store.reconcile();
        })();
        this.reconcilePromise = next;
        void next.catch(() => {
            if (this.reconcilePromise === next) this.reconcilePromise = null;
        });
        return next;
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.reconcilePromise = null;
        this.store.dispose();
    }
}
