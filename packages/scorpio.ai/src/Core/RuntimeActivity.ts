/**
 * 进程内运行引用计数。
 *
 * Agent 整轮执行、Memory/Agenda 后台 drain 和每次模型调用都持有同一个引用；
 * 宿主关闭时只需停止新工作并等待计数归零。
 */
class RuntimeActivity {
    private refCount = 0;
    private stopping = false;
    private idleWaiters = new Set<() => void>();

    get active(): number {
        return this.refCount;
    }

    get isStopping(): boolean {
        return this.stopping;
    }

    beginShutdown(): void {
        this.stopping = true;
    }

    retain(): () => void {
        this.refCount++;
        let released = false;
        return () => {
            if (released) return;
            released = true;
            this.refCount--;
            if (this.refCount !== 0) return;
            for (const resolve of this.idleWaiters) resolve();
            this.idleWaiters.clear();
        };
    }

    track<T>(operation: Promise<T>): Promise<T> {
        const release = this.retain();
        return operation.finally(release);
    }

    async trackStream<T>(operation: Promise<AsyncIterable<T>>): Promise<AsyncIterable<T>> {
        const release = this.retain();
        try {
            const stream = await operation;
            return (async function* () {
                try {
                    yield* stream;
                } finally {
                    release();
                }
            })();
        } catch (error) {
            release();
            throw error;
        }
    }

    async waitForIdle(): Promise<void> {
        while (this.refCount > 0) {
            await new Promise<void>(resolve => this.idleWaiters.add(resolve));
        }
    }
}

export const runtimeActivity = new RuntimeActivity();
