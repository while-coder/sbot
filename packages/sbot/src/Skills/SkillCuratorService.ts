import fs from 'fs';
import path from 'path';
import { SkillUsageTracker, type SkillUsageData } from 'scorpio.ai';
import { LoggerService } from '../Core/LoggerService';

const logger = LoggerService.getLogger('SkillCuratorService');

const STALE_AFTER_DAYS = 30;
const ARCHIVE_AFTER_DAYS = 90;

export class SkillCuratorService {
    private intervalHandle?: ReturnType<typeof setInterval>;
    private tracker = new SkillUsageTracker();

    constructor(
        private skillsDirs: string[],
        private intervalMs: number = 7 * 24 * 60 * 60 * 1000,
    ) {}

    start(): void {
        logger.info(`Curator started, interval: ${this.intervalMs / 1000 / 3600}h, dirs: ${this.skillsDirs.length}`);
        this.intervalHandle = setInterval(() => this.curate().catch(e => logger.error(`Curator error: ${e.message}`)), this.intervalMs);
        // 启动后延迟 10 分钟执行一次
        setTimeout(() => this.curate().catch(e => logger.error(`Curator initial run error: ${e.message}`)), 10 * 60 * 1000);
    }

    stop(): void {
        if (this.intervalHandle) {
            clearInterval(this.intervalHandle);
            this.intervalHandle = undefined;
        }
    }

    async curate(): Promise<void> {
        let transitioned = 0;
        for (const dir of this.skillsDirs) {
            if (!fs.existsSync(dir)) continue;
            try {
                for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                    if (!entry.isDirectory() || entry.name === '.archive') continue;
                    const skillPath = path.join(dir, entry.name);
                    const usage = this.tracker.getUsage(skillPath);
                    if (!usage || usage.pinned) continue;

                    const daysSinceLastUse = this.daysSince(usage.lastUsedAt ?? usage.createdAt);

                    if (usage.state === 'active' && daysSinceLastUse > STALE_AFTER_DAYS) {
                        this.transition(skillPath, usage, 'stale');
                        transitioned++;
                    } else if (usage.state === 'stale' && daysSinceLastUse > ARCHIVE_AFTER_DAYS) {
                        this.archiveSkill(dir, entry.name, usage);
                        transitioned++;
                    }
                }
            } catch (e: any) {
                logger.error(`Curator scan error in ${dir}: ${e.message}`);
            }
        }
        if (transitioned > 0) logger.info(`Curator: ${transitioned} skill(s) transitioned`);
    }

    private transition(skillPath: string, usage: SkillUsageData, newState: 'stale' | 'archived'): void {
        usage.state = newState;
        try {
            fs.writeFileSync(path.join(skillPath, '.usage.json'), JSON.stringify(usage, null, 2), 'utf-8');
            logger.info(`Skill "${path.basename(skillPath)}" → ${newState}`);
        } catch (e: any) {
            logger.error(`Failed to update usage for ${skillPath}: ${e.message}`);
        }
    }

    private archiveSkill(parentDir: string, skillName: string, usage: SkillUsageData): void {
        const skillPath = path.join(parentDir, skillName);
        const archiveBase = path.join(parentDir, '.archive');
        if (!fs.existsSync(archiveBase)) fs.mkdirSync(archiveBase, { recursive: true });

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const dest = path.join(archiveBase, `${skillName}_${timestamp}`);
        try {
            fs.renameSync(skillPath, dest);
            this.transition(dest, usage, 'archived');
        } catch (e: any) {
            logger.error(`Failed to archive skill ${skillName}: ${e.message}`);
        }
    }

    private daysSince(isoDate: string): number {
        return (Date.now() - new Date(isoDate).getTime()) / (1000 * 60 * 60 * 24);
    }
}
