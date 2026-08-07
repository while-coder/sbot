interface TimerExecutorOptions<THandle> {
    stop: (handle: THandle) => void;
    concurrencyGuard?: boolean;
}

export class TimerExecutor<THandle> {
    private readonly timers = new Map<number, THandle>();
    private readonly running = new Set<number>();

    constructor(private readonly options: TimerExecutorOptions<THandle>) {}

    set(id: number, handle: THandle): void {
        this.cancel(id);
        this.timers.set(id, handle);
    }

    cancel(id: number): void {
        const handle = this.timers.get(id);
        if (handle) {
            this.options.stop(handle);
            this.timers.delete(id);
        }
    }

    stopAll(): void {
        for (const handle of this.timers.values()) this.options.stop(handle);
        this.timers.clear();
    }

    async execute(id: number, fn: () => Promise<void>): Promise<boolean> {
        if (this.options.concurrencyGuard && this.running.has(id)) return false;
        this.running.add(id);
        try {
            await fn();
            return true;
        } finally {
            this.running.delete(id);
        }
    }
}
