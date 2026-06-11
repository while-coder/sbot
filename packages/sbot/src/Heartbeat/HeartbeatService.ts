import fs from "fs";
import { database, HeartbeatRow, StateRow } from "../Core/Database";
import { config } from "../Core/Config";
import { LoggerService } from "../Core/LoggerService";
import { TimerExecutor } from "../Core/TimerExecutor";
import { executeHeartbeat, type HeartbeatExecutionContext } from "./executeHeartbeat";

const logger = LoggerService.getLogger("HeartbeatService.ts");

class HeartbeatService {
    // 同时承载 setInterval（fixed 模式）和 setTimeout（smart 模式）句柄。
    // Node 里两种 timer 是同一类型，clearTimeout 也能取消 setInterval。
    private executor = new TimerExecutor<NodeJS.Timeout>({
        name: "Heartbeat",
        stop: h => clearTimeout(h),
        concurrencyGuard: true,
    });

    async start(): Promise<void> {
        await this.migrateFromSettings();
        const rows = await database.findAll<HeartbeatRow>(database.heartbeat);
        let loaded = 0;
        for (const row of rows) {
            if (!row.enabled) continue;
            if (this.schedule(row)) loaded++;
        }
        if (loaded > 0) {
            logger.info(`Heartbeat service started: ${loaded} heartbeat(s) scheduled`);
        }
    }

    private schedule(row: HeartbeatRow): boolean {
        if (row.intervalMinutes <= 0) {
            logger.error(`Heartbeat [${row.id}] invalid interval: ${row.intervalMinutes} minutes`);
            return false;
        }

        if (row.mode === 'smart') {
            this.scheduleNextSmart(row.id, row.intervalMinutes, row.jitterMinPct, row.jitterMaxPct);
            return true;
        }

        const ms = row.intervalMinutes * 60_000;
        const interval = setInterval(() => this.execute(row.id), ms);
        this.executor.set(row.id, interval);
        logger.info(`Heartbeat [${row.id}] scheduled (fixed interval: ${row.intervalMinutes}m)`);
        return true;
    }

    private scheduleNextSmart(heartbeatId: number, intervalMinutes: number, jitterMinPct: number, jitterMaxPct: number): void {
        const lo = Math.max(1, Math.min(jitterMinPct, jitterMaxPct));
        const hi = Math.max(lo, Math.max(jitterMinPct, jitterMaxPct));
        const factor = lo + Math.random() * (hi - lo);
        const delayMs = Math.max(1_000, Math.round(intervalMinutes * 60_000 * factor / 100));
        const handle = setTimeout(async () => {
            try {
                await this.execute(heartbeatId);
            } finally {
                // 仅在 timer 仍由我们持有时才续上下一次（execute 里若已 cancel——删除/禁用/切到 fixed——别复活）。
                if (this.executor.has(heartbeatId)) {
                    const fresh = await database.findByPk<HeartbeatRow>(database.heartbeat, heartbeatId);
                    if (fresh?.enabled && fresh.mode === 'smart') {
                        this.scheduleNextSmart(fresh.id, fresh.intervalMinutes, fresh.jitterMinPct, fresh.jitterMaxPct);
                    }
                }
            }
        }, delayMs);
        this.executor.set(heartbeatId, handle);
        logger.info(`Heartbeat [${heartbeatId}] smart next in ~${Math.round(delayMs / 60_000)}m (factor=${factor.toFixed(2)})`);
    }

    private async execute(heartbeatId: number): Promise<void> {
        const row = await database.findByPk<HeartbeatRow>(database.heartbeat, heartbeatId);
        if (!row) {
            logger.warn(`Heartbeat [${heartbeatId}] not found in database, cancelling`);
            this.executor.cancel(heartbeatId);
            return;
        }

        const ran = await this.executor.execute(heartbeatId, async () => {
            const ctx: HeartbeatExecutionContext = { heartbeatId, config: row };
            await executeHeartbeat(ctx);
        });

        if (!ran) {
            logger.debug(`Heartbeat [${heartbeatId}] still running, skipping`);
        }
    }

    stopAll(): void {
        this.executor.stopAll();
    }

    async reload(heartbeatId: number): Promise<void> {
        const row = await database.findByPk<HeartbeatRow>(database.heartbeat, heartbeatId);
        this.executor.cancel(heartbeatId);
        if (row && row.enabled) {
            this.schedule(row);
        }
    }

    async reloadAll(): Promise<void> {
        this.stopAll();
        await this.start();
    }

    async triggerOnce(heartbeatId: number): Promise<void> {
        await this.execute(heartbeatId);
    }

    // ── CRUD ──

    async getAll(): Promise<HeartbeatRow[]> {
        return database.findAll<HeartbeatRow>(database.heartbeat, { order: [['id', 'ASC']] });
    }

    async getById(id: number): Promise<HeartbeatRow | null> {
        return database.findByPk<HeartbeatRow>(database.heartbeat, id);
    }

    async create(data: Omit<HeartbeatRow, 'id' | 'lastRun' | 'createdAt' | 'lastSentAt' | 'dailySentDate' | 'dailySentCount'>): Promise<HeartbeatRow> {
        const row = await database.create<HeartbeatRow>(database.heartbeat, {
            ...data,
            lastRun: null,
            lastSentAt: null,
            dailySentDate: null,
            dailySentCount: 0,
            createdAt: Date.now(),
        });
        if (row.enabled) this.schedule(row);
        return row;
    }

    async update(id: number, data: Partial<Omit<HeartbeatRow, 'id' | 'lastRun' | 'createdAt'>>): Promise<HeartbeatRow | null> {
        await database.update(database.heartbeat, data, { where: { id } });
        const row = await database.findByPk<HeartbeatRow>(database.heartbeat, id);
        if (row) {
            this.executor.cancel(id);
            if (row.enabled) this.schedule(row);
        }
        return row;
    }

    async delete(id: number): Promise<void> {
        this.executor.cancel(id);
        await database.destroy(database.heartbeat, { where: { id } });
    }

    async getStatus(): Promise<Array<HeartbeatRow & { running: boolean }>> {
        const rows = await this.getAll();
        return rows.map(row => ({ ...row, running: this.executor.isRunning(row.id) }));
    }

    // ── 从旧 settings.json 一次性迁移 ──

    private async migrateFromSettings(): Promise<void> {
        const count = await database.count(database.heartbeat);
        if (count > 0) return;

        let raw: any;
        try {
            const settingsPath = config.getConfigPath("settings.json");
            const content = fs.readFileSync(settingsPath, "utf-8");
            raw = JSON.parse(content);
        } catch {
            return;
        }

        const heartbeats = raw?.heartbeats as Record<string, any> | undefined;
        if (!heartbeats || Object.keys(heartbeats).length === 0) return;

        logger.info(`Migrating ${Object.keys(heartbeats).length} heartbeat(s) from settings.json to database`);

        for (const [oldId, hb] of Object.entries(heartbeats)) {
            let lastRun: number | null = null;
            try {
                const row = await database.findOne<StateRow>(database.state, { where: { key: `heartbeat_lastRun_${oldId}` } });
                if (row) lastRun = Number(row.value);
            } catch {}

            await database.create(database.heartbeat, {
                name: hb.name ?? '',
                intervalMinutes: parseExprToMinutes(hb.expr ?? '30m'),
                promptFile: hb.promptFile ?? '',
                target: hb.target ?? 0,
                enabled: hb.enabled !== false,
                activeHoursStart: hb.activeHours?.start ?? null,
                activeHoursEnd: hb.activeHours?.end ?? null,
                activeHoursTimezone: hb.activeHours?.timezone ?? null,
                lastRun,
                createdAt: Date.now(),
            });

            try {
                await database.destroy(database.state, { where: { key: `heartbeat_lastRun_${oldId}` } });
            } catch {}
        }

        try {
            delete raw.heartbeats;
            const settingsPath = config.getConfigPath("settings.json");
            fs.writeFileSync(settingsPath, JSON.stringify(raw, null, 2), "utf-8");
        } catch {}

        logger.info("Heartbeat migration from settings.json completed");
    }
}

const DURATION_RE = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/;

function parseExprToMinutes(expr: string): number {
    const trimmed = expr.trim();
    const match = trimmed.match(DURATION_RE);
    if (!match) return 30;
    const hours = parseInt(match[1] || '0', 10);
    const minutes = parseInt(match[2] || '0', 10);
    const total = hours * 60 + minutes;
    return total > 0 ? total : 30;
}

export const heartbeatService = new HeartbeatService();
