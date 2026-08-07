import type { IWikiService } from "../Service/IWikiService";
import { WikiAgentPlugin } from "./WikiAgentPlugin";

/** 持有聚合插件背后的 WikiService，并保证只释放一次。 */
export class WikiPluginLease {
    readonly plugin: WikiAgentPlugin;
    private released = false;

    constructor(private readonly services: IWikiService[]) {
        this.plugin = new WikiAgentPlugin(services);
    }

    async release(): Promise<void> {
        if (this.released) return;
        this.released = true;
        await Promise.all(this.services.map(service => service.dispose()));
    }
}
