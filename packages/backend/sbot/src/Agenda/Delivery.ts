import type {
    AgendaDeliveryHandler,
    AgendaDeliveryRequest,
    AgendaItem,
    AgendaTrigger,
} from "agent.agenda";
import type { ChannelSessionRow } from "../Core/Database";
import { database } from "../Core/Database";
import { config } from "../Core/Config";
import { LoggerService } from "../Core/LoggerService";
import { triggerSession } from "../Core/triggerSession";
import { channelDataService } from "../Session/ChannelDataService";

const logger = LoggerService.getLogger("Agenda/Delivery.ts");

/**
 * 在 agenda 模板触发时，解析投递目标（channel session）。
 *
 * 因为 agenda 模板是跨 profile/channel 共享的，没有唯一"所有者会话"。
 * 优先级：
 *   1. trigger.channelSessionId：上次成功投递时记录的会话；仍指向该 agenda 模板则继续使用
 *   2. 扫描所有 session：寻找 effective.resolved.agenda === agendaId 的第一个匹配
 */
export function createAgendaDeliveryHandler(
    updateSessionId: (agendaId: string, triggerId: number, channelSessionId: number) => Promise<unknown>,
): AgendaDeliveryHandler {
    return async (request: AgendaDeliveryRequest) => {
        const delivery = await resolveAgendaDelivery(
            request.agendaId,
            request.item,
            request.trigger,
            updateSessionId,
        );
        if (!delivery) throw new Error("无投递会话");
        return triggerSession({
            targetId: delivery.id,
            message: request.trigger.message,
            mode: request.trigger.action,
            tag: `日程触发器 #${request.trigger.id}`,
        });
    };
}

export async function resolveAgendaDelivery(
    agendaId: string,
    _item: AgendaItem,
    trigger: AgendaTrigger,
    updateSessionId: (agendaId: string, triggerId: number, channelSessionId: number) => Promise<unknown>,
): Promise<ChannelSessionRow | null> {
    if (trigger.channelSessionId > 0) {
        const hinted = await channelDataService.getSession(trigger.channelSessionId);
        if (hinted && await sessionUsesAgenda(hinted, agendaId)) return hinted;
    }

    const candidates = await database.findAll<ChannelSessionRow>(database.channelSession);
    for (const candidate of candidates) {
        if (await sessionUsesAgenda(candidate, agendaId)) {
            await updateSessionId(agendaId, trigger.id, candidate.id);
            trigger.channelSessionId = candidate.id;
            return candidate;
        }
    }

    // 所有会话都不再使用该 agenda → 提醒无接收方，只能丢弃。属配置漂移类错误
    // （用户感知是"提醒没响"），用 error 级别突出。
    const name = config.getAgendaProfile(agendaId)?.name ?? agendaId;
    const brief = trigger.message.replace(/\s+/g, " ").trim().slice(0, 80);
    logger.error(`[日程:${name}] 提醒无接收会话，本次触发已丢弃：触发器=#${trigger.id}（${brief}）。请检查 agenda profile 的引用会话。`);
    return null;
}

async function sessionUsesAgenda(session: ChannelSessionRow, agendaId: string): Promise<boolean> {
    const eff = await channelDataService.getEffective(session.id);
    return eff?.resolved.agenda === agendaId;
}
