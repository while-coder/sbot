import fs from 'fs';
import path from 'path';

export interface UsageData {
    useCount: number;
    viewCount: number;
    patchCount: number;
    createdAt: string;
    lastUsedAt?: string;
    lastViewedAt?: string;
    state: 'active' | 'stale' | 'archived';
    pinned: boolean;
    createdBy: 'user' | 'agent' | 'auto';
}

const DEFAULT_USAGE: UsageData = {
    useCount: 0,
    viewCount: 0,
    patchCount: 0,
    createdAt: new Date().toISOString(),
    state: 'active',
    pinned: false,
    createdBy: 'user',
};

export class UsageTracker {
    private cache = new Map<string, UsageData>();

    getUsage(dirPath: string): UsageData | undefined {
        const cached = this.cache.get(dirPath);
        if (cached) return cached;
        return this.load(dirPath);
    }

    recordUse(dirPath: string): void {
        const data = this.getOrCreate(dirPath);
        data.useCount++;
        data.lastUsedAt = new Date().toISOString();
        this.save(dirPath, data);
    }

    recordView(dirPath: string): void {
        const data = this.getOrCreate(dirPath);
        data.viewCount++;
        data.lastViewedAt = new Date().toISOString();
        this.save(dirPath, data);
    }

    recordPatch(dirPath: string): void {
        const data = this.getOrCreate(dirPath);
        data.patchCount++;
        this.save(dirPath, data);
    }

    createUsage(dirPath: string, createdBy: 'user' | 'agent' | 'auto'): UsageData {
        const data: UsageData = { ...DEFAULT_USAGE, createdAt: new Date().toISOString(), createdBy };
        this.save(dirPath, data);
        return data;
    }

    private getOrCreate(dirPath: string): UsageData {
        return this.getUsage(dirPath) ?? this.createUsage(dirPath, 'user');
    }

    private usagePath(dirPath: string): string {
        return path.join(dirPath, '.usage.json');
    }

    private load(dirPath: string): UsageData | undefined {
        const filePath = this.usagePath(dirPath);
        try {
            if (!fs.existsSync(filePath)) return undefined;
            const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as UsageData;
            this.cache.set(dirPath, data);
            return data;
        } catch {
            return undefined;
        }
    }

    private save(dirPath: string, data: UsageData): void {
        try {
            fs.writeFileSync(this.usagePath(dirPath), JSON.stringify(data, null, 2), 'utf-8');
            this.cache.set(dirPath, data);
        } catch { /* ignore write errors */ }
    }
}
