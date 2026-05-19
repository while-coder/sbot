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
}

export class UsageTracker {
    private filePath: string;

    constructor(dirPath: string) {
        this.filePath = path.join(dirPath, '.usage.json');
    }

    get(): UsageData | undefined {
        try {
            if (!fs.existsSync(this.filePath)) return undefined;
            return JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as UsageData;
        } catch {
            return undefined;
        }
    }

    recordUse(): void {
        const data = this.getOrCreate();
        data.useCount++;
        data.lastUsedAt = new Date().toISOString();
        this.save(data);
    }

    recordView(): void {
        const data = this.getOrCreate();
        data.viewCount++;
        data.lastViewedAt = new Date().toISOString();
        this.save(data);
    }

    recordPatch(): void {
        const data = this.getOrCreate();
        data.patchCount++;
        this.save(data);
    }

    create(): UsageData {
        const data: UsageData = {
            useCount: 0,
            viewCount: 0,
            patchCount: 0,
            createdAt: new Date().toISOString(),
            state: 'active',
            pinned: false,
        };
        this.save(data);
        return data;
    }

    save(data: UsageData): void {
        try {
            fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
        } catch { /* ignore write errors */ }
    }

    private getOrCreate(): UsageData {
        return this.get() ?? this.create();
    }
}
