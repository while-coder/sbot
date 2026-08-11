export type Middleware<T> = (ctx: T, next: () => Promise<void>) => Promise<void>;

export class MiddlewarePipeline<T> {
    private stack: Middleware<T>[] = [];

    use(fn: Middleware<T>): this {
        this.stack.push(fn);
        return this;
    }

    prepend(fn: Middleware<T>): this {
        this.stack.unshift(fn);
        return this;
    }

    remove(fn: Middleware<T>): boolean {
        const idx = this.stack.indexOf(fn);
        if (idx === -1) return false;
        this.stack.splice(idx, 1);
        return true;
    }

    async execute(ctx: T, final: (ctx: T) => Promise<void>): Promise<void> {
        let index = -1;
        const dispatch = async (i: number): Promise<void> => {
            if (i <= index) throw new Error('next() called multiple times');
            index = i;
            if (i < this.stack.length) {
                await this.stack[i](ctx, () => dispatch(i + 1));
            } else {
                await final(ctx);
            }
        };
        await dispatch(0);
    }
}
