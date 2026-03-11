export const Util = {
  get NowDate(): number {
    return Date.now();
  },
  sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  },
  parseJson<T>(str: string, defaultValue: T | undefined): T | undefined {
    try {
      return JSON.parse(str) as T;
    } catch {
      return defaultValue;
    }
  },
};
