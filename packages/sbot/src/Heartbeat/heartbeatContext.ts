import { AgendaStatus, TimeUtils } from "scorpio.ai";
import { agendaStorePool } from "../Agenda/AgendaStorePool";
import { LoggerService } from "../Core/LoggerService";
import { type HeartbeatCommonRow } from "../Core/Database";

const logger = LoggerService.getLogger("heartbeatContext.ts");

export async function buildHeartbeatPromptVars(row: HeartbeatCommonRow): Promise<Record<string, string>> {
    return {
        now: TimeUtils.formatDateTime(TimeUtils.now(), row.activeHoursTimezone),
        lastSentAgo: row.lastSentAt ? TimeUtils.formatTimeAgo(row.lastSentAt) : "never",
        agendaList: await buildAgendaContext(row.agendaId),
    };
}

async function buildAgendaContext(agendaId: string | null): Promise<string> {
    if (!agendaId) return "(No agenda context configured)";
    try {
        const records = await agendaStorePool.get(agendaId).listItems();
        const pending = records.filter(r => r.item.status === AgendaStatus.Pending);
        if (pending.length === 0) return "(No pending agenda items)";

        const lines = pending.slice(0, 30).map(r => {
            const item = r.item;
            const due = item.dueAt ? ` due=${TimeUtils.formatWhen(item.dueAt)}` : "";
            const next = firstEnabledNextFire(r.triggers);
            const nextText = next ? ` next=${TimeUtils.formatWhen(next)}` : "";
            return `#${item.id} [${item.priority}] ${item.content}${due}${nextText}`;
        });
        return `${pending.length} pending item(s):\n${lines.join("\n")}`;
    } catch (err: any) {
        logger.warn(`load agenda context [${agendaId}] failed: ${err?.message ?? String(err)}`);
        return "(Agenda context failed to load)";
    }
}

function firstEnabledNextFire(triggers: { enabled: boolean; nextFireAt: number | null }[] | undefined): number | null {
    if (!triggers) return null;
    let earliest: number | null = null;
    for (const t of triggers) {
        if (!t.enabled || t.nextFireAt == null) continue;
        if (earliest == null || t.nextFireAt < earliest) earliest = t.nextFireAt;
    }
    return earliest;
}
