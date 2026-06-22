import type { AgendaItem, AgendaTrigger } from "scorpio.ai";
import type { ChannelSessionRow } from "../Core/Database";
import { database } from "../Core/Database";
import { LoggerService } from "../Core/LoggerService";
import { channelDataService } from "../Session/ChannelDataService";
import { agendaStorePool } from "./AgendaStorePool";

const logger = LoggerService.getLogger("Agenda/Delivery.ts");

/**
 * 在 agenda 模板触发时，解析投递目标（channel session）。
 *
 * 因为 agenda 模板是跨 profile/channel 共享的，没有唯一"所有者会话"。
 * 优先级：
 *   1. trigger.channelSessionId：上次成功投递时记录的会话；仍指向该 agenda 模板则继续使用
 *   2. 扫描所有 session：寻找 effective.resolved.agenda === agendaId 的第一个匹配
 */
export async function resolveAgendaDelivery(agendaId: string, _item: AgendaItem, trigger: AgendaTrigger): Promise<ChannelSessionRow | null> {
    if (trigger.channelSessionId > 0) {
        const hinted = await channelDataService.getSession(trigger.channelSessionId);
        if (hinted && await sessionUsesAgenda(hinted, agendaId)) return hinted;
    }

    const candidates = await database.findAll<ChannelSessionRow>(database.channelSession);
    for (const candidate of candidates) {
        if (await sessionUsesAgenda(candidate, agendaId)) {
            await agendaStorePool.get(agendaId).updateTrigger(trigger.id, { channelSessionId: candidate.id });
            trigger.channelSessionId = candidate.id;
            return candidate;
        }
    }

    logger.warn(`Agenda trigger [${trigger.id}] no session uses agenda=${agendaId}`);
    return null;
}

async function sessionUsesAgenda(session: ChannelSessionRow, agendaId: string): Promise<boolean> {
    const eff = await channelDataService.getEffective(session.id);
    return eff?.resolved.agenda === agendaId;
}
