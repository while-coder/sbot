export interface TimerExecutorOptions<THandle> {
    name: string;
    stop: (handle: THandle) => void;
    concurrencyGuard?: boolean;
}

export class TimerExecutor<THandle> {
    private timers = new Map<number, THandle>();
    private running = new Set<number>();

    constructor(private opts: TimerExecutorOptions<THandle>) {}

    set(id: number, handle: THandle): void {
        this.cancel(id);
        this.timers.set(id, handle);
    }

    get(id: number): THandle | undefined {
        return this.timers.get(id);
    }

    cancel(id: number): void {
        const handle = this.timers.get(id);
        if (handle) {
            this.opts.stop(handle);
            this.timers.delete(id);
        }
    }

    stopAll(): void {
        for (const handle of this.timers.values()) {
            this.opts.stop(handle);
        }
        this.timers.clear();
    }

    has(id: number): boolean {
        return this.timers.has(id);
    }

    isRunning(id: number): boolean {
        return this.running.has(id);
    }

    get size(): number {
        return this.timers.size;
    }

    async execute(id: number, fn: () => Promise<void>): Promise<boolean> {
        if (this.opts.concurrencyGuard && this.running.has(id)) {
            return false;
        }
        this.running.add(id);
        try {
            await fn();
            return true;
        } finally {
            this.running.delete(id);
        }
    }
}
