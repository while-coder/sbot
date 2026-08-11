import { database, HeartbeatMode, type HeartbeatCommonRow, type HeartbeatRow, type SmartHeartbeatRow } from "../Core/Database";
import { LoggerService } from "../Core/LoggerService";
import { TimerExecutor } from "../Core/TimerExecutor";
import { FixedHeartbeat } from "./FixedHeartbeat";
import { HeartbeatBase, type HeartbeatScheduleContext } from "./HeartbeatBase";
import { SmartHeartbeat } from "./SmartHeartbeat";

const logger = LoggerService.getLogger("HeartbeatService.ts");

class HeartbeatService {
    // 同时承载 setInterval（fixed 模式）和 setTimeout（smart 模式）句柄。
    // Node 里两种 timer 是同一类型，clearTimeout 也能取消 setInterval。
    private executor = new TimerExecutor<NodeJS.Timeout>({
        name: "Heartbeat",
        stop: h => clearTimeout(h),
        concurrencyGuard: true,
    });

    private scheduler: HeartbeatScheduleContext = {
        setTimer: (heartbeatId, handle) => this.executor.set(heartbeatId, handle),
        hasTimer: heartbeatId => this.executor.has(heartbeatId),
        execute: heartbeatId => this.execute(heartbeatId),
    };

    async start(): Promise<void> {
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
        return this.createHeartbeat(row).schedule(this.scheduler);
    }

    private async execute(heartbeatId: number): Promise<void> {
        const row = await database.findByPk<HeartbeatRow>(database.heartbeat, heartbeatId);
        if (!row) {
            logger.warn(`Heartbeat [${heartbeatId}] not found in database, cancelling`);
            this.executor.cancel(heartbeatId);
            return;
        }

        const ran = await this.executor.execute(heartbeatId, async () => {
            await this.createHeartbeat(row).execute();
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

    async create(data: HeartbeatCreateData): Promise<HeartbeatRow> {
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

    async update(id: number, data: HeartbeatUpdateData): Promise<HeartbeatRow | null> {
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

    private createHeartbeat(row: HeartbeatRow): HeartbeatBase {
        if (row.mode === HeartbeatMode.Smart) {
            return new SmartHeartbeat(row);
        }
        return new FixedHeartbeat(row);
    }
}

type SmartHeartbeatConfig = Pick<SmartHeartbeatRow,
    'decisionPromptFile' |
    'decisionModelId'
>;

type HeartbeatRuntimeFields = Pick<HeartbeatCommonRow,
    'lastSentAt' |
    'dailySentDate' |
    'dailySentCount'
>;

type HeartbeatCreateData =
    Omit<HeartbeatCommonRow, 'id' | 'lastRun' | 'createdAt' | keyof HeartbeatRuntimeFields> &
    Partial<SmartHeartbeatConfig>;

type HeartbeatUpdateData =
    Partial<Omit<HeartbeatCommonRow, 'id' | 'lastRun' | 'createdAt'> & SmartHeartbeatConfig>;

export const heartbeatService = new HeartbeatService();
