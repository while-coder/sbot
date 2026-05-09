import { CronJob } from "cron";
import { config } from "../Core/Config";
import { database } from "../Core/Database";
import { LoggerService } from "../Core/LoggerService";
import { durationToCron, durationToMs } from "./durationParser";
import { executeHeartbeat, type HeartbeatExecutionContext } from "./executeHeartbeat";

const logger = LoggerService.getLogger("HeartbeatService.ts");

class HeartbeatService {
    private jobs = new Map<string, CronJob>();
    private intervals = new Map<string, ReturnType<typeof setInterval>>();
    private running = new Set<string>();

    async start(): Promise<void> {
        const heartbeats = config.settings.heartbeats;
        if (!heartbeats) return;

        let loaded = 0;
        for (const [id, hbConfig] of Object.entries(heartbeats)) {
            if (hbConfig.enabled === false) continue;
            if (this.schedule(id, hbConfig.expr)) loaded++;
        }
        if (loaded > 0) {
            logger.info(`Heartbeat service started: ${loaded} heartbeat(s) scheduled`);
        }
    }

    private schedule(heartbeatId: string, expr: string): boolean {
        this.cancel(heartbeatId);

        const cronExpr = durationToCron(expr);

        if (cronExpr) {
            try {
                const job = CronJob.from({
                    cronTime: cronExpr,
                    onTick: () => this.execute(heartbeatId),
                    start: true,
                });
                this.jobs.set(heartbeatId, job);
                logger.info(`Heartbeat [${heartbeatId}] scheduled (cron: ${cronExpr}), next: ${job.nextDate().toISO()}`);
                return true;
            } catch (e: any) {
                logger.error(`Heartbeat [${heartbeatId}] cron scheduling failed: ${e?.message}`);
                return false;
            }
        }

        // cron 无法表示的时长，用 setInterval 兜底
        const ms = durationToMs(expr);
        if (ms) {
            const interval = setInterval(() => this.execute(heartbeatId), ms);
            this.intervals.set(heartbeatId, interval);
            logger.info(`Heartbeat [${heartbeatId}] scheduled (interval: ${ms}ms)`);
            return true;
        }

        logger.error(`Heartbeat [${heartbeatId}] invalid expr: "${expr}"`);
        return false;
    }

    private cancel(heartbeatId: string): void {
        const job = this.jobs.get(heartbeatId);
        if (job) {
            job.stop();
            this.jobs.delete(heartbeatId);
        }
        const interval = this.intervals.get(heartbeatId);
        if (interval) {
            clearInterval(interval);
            this.intervals.delete(heartbeatId);
        }
    }

    private async execute(heartbeatId: string): Promise<void> {
        const hbConfig = config.getHeartbeat(heartbeatId);
        if (!hbConfig) {
            logger.warn(`Heartbeat [${heartbeatId}] config not found, cancelling`);
            this.cancel(heartbeatId);
            return;
        }

        if (this.running.has(heartbeatId)) {
            logger.debug(`Heartbeat [${heartbeatId}] still running, skipping`);
            return;
        }

        const ctx: HeartbeatExecutionContext = {
            heartbeatId,
            config: hbConfig,
        };

        this.running.add(heartbeatId);
        try {
            await executeHeartbeat(ctx);
        } catch (e: any) {
            logger.error(`Heartbeat [${heartbeatId}] execution error: ${e?.message ?? e}`);
        } finally {
            this.running.delete(heartbeatId);
        }
    }

    stopAll(): void {
        for (const [, job] of this.jobs) job.stop();
        this.jobs.clear();
        for (const [, interval] of this.intervals) clearInterval(interval);
        this.intervals.clear();
    }

    async reload(heartbeatId: string): Promise<void> {
        const hbConfig = config.getHeartbeat(heartbeatId);
        if (hbConfig && hbConfig.enabled !== false) {
            this.schedule(heartbeatId, hbConfig.expr);
        } else {
            this.cancel(heartbeatId);
        }
    }

    async reloadAll(): Promise<void> {
        this.stopAll();
        await this.start();
    }

    async triggerOnce(heartbeatId: string): Promise<void> {
        await this.execute(heartbeatId);
    }

    async getStatus(): Promise<Array<{ id: string; nextRun: string | null; lastRun: string | null; running: boolean; enabled: boolean }>> {
        const heartbeats = config.settings.heartbeats ?? {};
        const results = [];
        for (const [id, hbConfig] of Object.entries(heartbeats)) {
            const job = this.jobs.get(id);
            const nextRun = job ? job.nextDate().toISO() : null;
            let lastRun: string | null = null;
            try {
                const row = await database.state.findOne({ where: { key: `heartbeat_lastRun_${id}` } });
                if (row) lastRun = new Date(Number(row.getDataValue('value'))).toISOString();
            } catch {}
            results.push({ id, nextRun, lastRun, running: this.running.has(id), enabled: hbConfig.enabled !== false });
        }
        return results;
    }
}

export const heartbeatService = new HeartbeatService();
