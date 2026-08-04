import { MemoryScope } from "../Storage/IMemoryStore";
import type { MemoryService } from "./MemoryService";
import { MemoryServiceView } from "./MemoryServiceView";

/** 仅全局记忆视图；管理与后台读取路径显式使用。 */
export class GlobalMemoryService extends MemoryServiceView {
    constructor(owner: MemoryService) {
        super(owner, { scope: MemoryScope.Global });
    }
}
