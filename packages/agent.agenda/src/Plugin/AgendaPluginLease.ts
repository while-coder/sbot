import type { IAgentPlugin } from "scorpio.ai";
import type { IAgendaService } from "../Service/IAgendaService";
import { AgendaAgentPlugin } from "./AgendaAgentPlugin";

/** Pairs an Agent plugin with the AgendaService reference it owns. */
export class AgendaPluginLease {
    readonly plugin: IAgentPlugin;
    private released = false;

    constructor(private readonly service: IAgendaService) {
        this.plugin = new AgendaAgentPlugin(service);
    }

    release(): void {
        if (this.released) return;
        this.released = true;
        this.service.release();
    }
}
