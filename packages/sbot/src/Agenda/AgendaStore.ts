import path from "path";
import { AgendaStore } from "scorpio.ai";
import { config } from "../Core/Config";

export const agendaStore = new AgendaStore(
    profileId => path.join(config.getProfileAgendaPath(String(profileId)), "agenda.db"),
);
