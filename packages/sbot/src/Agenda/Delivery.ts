import type { AgendaItemRow, AgendaTriggerRow } from "scorpio.ai";
import type { ChannelSessionRow } from "../Core/Database";
import { database } from "../Core/Database";
import { LoggerService } from "../Core/LoggerService";
import { channelDataService } from "../Session/ChannelDataService";
import { agendaStore } from "./AgendaStore";

const logger = LoggerService.getLogger("Agenda/Delivery.ts");

export async function resolveAgendaDelivery(item: AgendaItemRow, trigger: AgendaTriggerRow): Promise<ChannelSessionRow | null> {
    const profileId = item.profileId;
    if (!profileId || profileId <= 0) return null;
    const profile = await channelDataService.getProfile(profileId);
    if (!profile) return null;

    const primary = trigger.channelHint > 0
        ? await channelDataService.getSession(trigger.channelHint)
        : null;
    if (primary && primary.profileId === profileId) return primary;

    const candidates = await database.findAll<ChannelSessionRow>(database.channelSession, { where: { profileId } });
    if (candidates.length === 0) {
        logger.warn(`Agenda trigger [${trigger.id}] no fallback session under profileId=${profileId}`);
        return null;
    }

    const sameChannel = primary ? candidates.find(c => c.channelId === primary.channelId) : undefined;
    const picked = sameChannel ?? candidates[0];
    await agendaStore.updateTrigger(trigger.id, { channelHint: picked.id });
    trigger.channelHint = picked.id;
    return picked;
}
