import { TimeUtils } from "scorpio.ai";
import { database, type HeartbeatRow } from "../Core/Database";
import { LoggerService } from "../Core/LoggerService";
import { checkThrottle, recordSentPatch } from "./throttle";

const logger = LoggerService.getLogger("HeartbeatBase.ts");

export interface HeartbeatScheduleContext {
    setTimer(heartbeatId: number, handle: NodeJS.Timeout): void;
    hasTimer(heartbeatId: number): boolean;
    execute(heartbeatId: number): Promise<void>;
}

export abstract class HeartbeatBase<TRow extends HeartbeatRow = HeartbeatRow> {
    constructor(protected readonly row: TRow) {}

    get id(): number {
        return this.row.id;
    }

    schedule(ctx: HeartbeatScheduleContext): boolean {
        if (this.row.intervalMinutes <= 0) {
            logger.error(`Heartbeat [${this.row.id}] invalid interval: ${this.row.intervalMinutes} minutes`);
            return false;
        }

        this.scheduleNext(ctx);
        return true;
    }

    async execute(): Promise<void> {
        const row = this.row;
        const tag = `[heartbeat:${row.id}]`;

        if (!row.enabled) return;

        if (!this.isInActiveHours(row)) {
            logger.debug(`${tag} skipped: outside active hours`);
            return;
        }

        const now = TimeUtils.now();
        const verdict = checkThrottle(row, now);
        if (!verdict.pass) {
            logger.debug(`${tag} throttled: ${verdict.reason}`);
            await this.recordRun(row);
            return;
        }

        const sent = await this.run(tag, row);
        if (sent) {
            await database.update(database.heartbeat, recordSentPatch(row, now), { where: { id: row.id } });
        }
        await this.recordRun(row);
    }

    protected abstract scheduleNext(ctx: HeartbeatScheduleContext): void;

    protected abstract run(tag: string, row: TRow): Promise<boolean>;

    protected intervalMs(): number {
        return this.row.intervalMinutes * TimeUtils.MINUTE_MS;
    }

    private isInActiveHours(row: TRow): boolean {
        if (row.activeHoursStart == null || row.activeHoursEnd == null) return true;
        return TimeUtils.isNowInHourRange(row.activeHoursStart, row.activeHoursEnd, row.activeHoursTimezone);
    }

    private async recordRun(row: TRow): Promise<void> {
        await database.update(database.heartbeat, { lastRun: TimeUtils.now() }, { where: { id: row.id } });
    }
}
