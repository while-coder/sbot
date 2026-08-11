import type { IMemoryService } from "../Service/IMemoryService";
import { MemoryAgentPlugin } from "./MemoryAgentPlugin";

/** 将 Agent plugin 与 pool acquire 得到的 scoped service 引用配对。 */
export class MemoryPluginLease {
    readonly plugin: MemoryAgentPlugin;
    private released = false;

    constructor(private readonly service: IMemoryService) {
        this.plugin = new MemoryAgentPlugin(service);
    }

    release(): void {
        if (this.released) return;
        this.released = true;
        this.service.release();
    }
}
