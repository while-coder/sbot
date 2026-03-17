export const NowDate = (): number => Date.now();

export function truncate(str: string, maxLen: number, ellipsis = '…'): string {
    return str.length > maxLen ? str.slice(0, maxLen) + ellipsis : str;
}

export const sleep = (ms: number): Promise<void> =>
    new Promise(resolve => setTimeout(resolve, ms));

export function parseJson<T>(str: string, defaultValue: T | undefined): T | undefined {
    try {
        return JSON.parse(str) as T;
    } catch {
        return defaultValue;
    }
}
