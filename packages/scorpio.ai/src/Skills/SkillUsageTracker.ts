import fs from 'fs';
import path from 'path';

export interface SkillUsageData {
    useCount: number;
    viewCount: number;
    patchCount: number;
    createdAt: string;
    lastUsedAt?: string;
    lastViewedAt?: string;
    state: 'active' | 'stale' | 'archived';
    pinned: boolean;
    createdBy: 'user' | 'agent';
}

const DEFAULT_USAGE: SkillUsageData = {
    useCount: 0,
    viewCount: 0,
    patchCount: 0,
    createdAt: new Date().toISOString(),
    state: 'active',
    pinned: false,
    createdBy: 'user',
};

export class SkillUsageTracker {
    private cache = new Map<string, SkillUsageData>();

    getUsage(skillPath: string): SkillUsageData | undefined {
        const cached = this.cache.get(skillPath);
        if (cached) return cached;
        return this.load(skillPath);
    }

    recordUse(skillPath: string): void {
        const data = this.getOrCreate(skillPath);
        data.useCount++;
        data.lastUsedAt = new Date().toISOString();
        this.save(skillPath, data);
    }

    recordView(skillPath: string): void {
        const data = this.getOrCreate(skillPath);
        data.viewCount++;
        data.lastViewedAt = new Date().toISOString();
        this.save(skillPath, data);
    }

    recordPatch(skillPath: string): void {
        const data = this.getOrCreate(skillPath);
        data.patchCount++;
        this.save(skillPath, data);
    }

    createUsage(skillPath: string, createdBy: 'user' | 'agent'): SkillUsageData {
        const data: SkillUsageData = { ...DEFAULT_USAGE, createdAt: new Date().toISOString(), createdBy };
        this.save(skillPath, data);
        return data;
    }

    private getOrCreate(skillPath: string): SkillUsageData {
        return this.getUsage(skillPath) ?? this.createUsage(skillPath, 'user');
    }

    private usagePath(skillPath: string): string {
        return path.join(skillPath, '.usage.json');
    }

    private load(skillPath: string): SkillUsageData | undefined {
        const filePath = this.usagePath(skillPath);
        try {
            if (!fs.existsSync(filePath)) return undefined;
            const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as SkillUsageData;
            this.cache.set(skillPath, data);
            return data;
        } catch {
            return undefined;
        }
    }

    private save(skillPath: string, data: SkillUsageData): void {
        try {
            fs.writeFileSync(this.usagePath(skillPath), JSON.stringify(data, null, 2), 'utf-8');
            this.cache.set(skillPath, data);
        } catch { /* ignore write errors */ }
    }
}
