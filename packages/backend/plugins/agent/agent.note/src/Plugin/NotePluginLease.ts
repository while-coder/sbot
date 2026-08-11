import type { INoteService } from "../Service/INoteService";
import { NoteAgentPlugin } from "./NoteAgentPlugin";

/** 持有聚合插件背后的 NoteService，并保证只释放一次。 */
export class NotePluginLease {
    readonly plugin: NoteAgentPlugin;
    private released = false;

    constructor(private readonly services: INoteService[]) {
        this.plugin = new NoteAgentPlugin(services);
    }

    async release(): Promise<void> {
        if (this.released) return;
        this.released = true;
        await Promise.all(this.services.map(service => service.dispose()));
    }
}
