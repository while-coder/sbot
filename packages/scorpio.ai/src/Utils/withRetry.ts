function isRetryable(error: any): boolean {
    if (error?.name === 'AbortError') return false;
    const status = error?.status
        ?? error?.status_code
        ?? error?.response?.status
        ?? error?.cause?.status
        ?? error?.cause?.status_code;
    if (status === 429 || status === 500 || status === 502 || status === 503) return true;
    const msg = (error?.message ?? '').toLowerCase();
    return /rate.?limit|timeout|econnreset|econnrefused|socket hang up|network|fetch failed/.test(msg);
}

export async function withRetry<T>(
    fn: () => Promise<T>,
    signal?: AbortSignal,
    maxRetries: number = 2,
): Promise<T> {
    for (let attempt = 0; ; attempt++) {
        try {
            return await fn();
        } catch (error: any) {
            if (signal?.aborted || attempt >= maxRetries || !isRetryable(error)) throw error;
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt) + Math.random() * 500));
        }
    }
}
