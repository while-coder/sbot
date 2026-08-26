import path from "path";
import { AgendaStorePool, AgendaTriggerEnginePool } from "agent.agenda";
import { config } from "../Core/Config";
import { LoggerService } from "../Core/LoggerService";
import { createAgendaDeliveryHandler } from "./Delivery";

export const agendaStorePool = new AgendaStorePool(
    agendaId => path.join(config.getAgendaPath(agendaId), "agenda.db"),
    () => Object.keys(config.settings.agendaProfiles ?? {}),
);

const delivery = createAgendaDeliveryHandler((agendaId, triggerId, channelSessionId) =>
    agendaStorePool.get(agendaId).updateTrigger(triggerId, { channelSessionId }),
);

export const agendaTriggerEnginePool = new AgendaTriggerEnginePool(
    agendaStorePool,
    delivery,
    LoggerService.getLogger("Agenda/TriggerEngine.ts"),
    agendaId => config.getAgendaProfile(agendaId)?.name ?? agendaId,
);
