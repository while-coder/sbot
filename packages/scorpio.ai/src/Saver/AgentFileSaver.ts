import { readFile, writeFile, unlink, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { dirname } from "path";
import { IAgentSaverService, ChatMessage, StoredMessage, ChatMessageOptions } from "./IAgentSaverService";
import { ILoggerService, ILogger } from "../Logger";
import { inject } from "scorpio.di";
import { T_DBPath } from "../Core/tokens";

interface ThreadFile {
    messages: StoredMessage[];
    thinks?: Record<string, StoredMessage[]>;
    metadata?: Record<string, string>;
    nextId?: number;
    compactedIds?: number[];
}

// ─────────────────────────────────────────────────────────────────────────────
// AgentFileSaver
// 直接读写指定的 JSON 文件，存储格式为 StoredMessage[]
// ─────────────────────────────────────────────────────────────────────────────

export class AgentFileSaver implements IAgentSaverService {
    private logger?: ILogger;
    private readonly filePath: string;
    private cache?: ThreadFile;

    constructor(
        @inject(T_DBPath) filePath: string,
        @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService
    ) {
        this.filePath = filePath;
        this.logger = loggerService?.getLogger("AgentFileSaver");
    }

    private async getFile(): Promise<ThreadFile> {
        if (this.cache) return this.cache;
        try {
            if (!existsSync(this.filePath)) {
                this.cache = { messages: [], thinks: {}, nextId: 1, compactedIds: [] };
            } else {
                const content = await readFile(this.filePath, "utf-8");
                this.cache = JSON.parse(content) as ThreadFile;
                let nextId = this.cache.nextId ?? 1;
                for (const m of this.cache.messages) {
                    if (m.id == null) m.id = nextId++;
                }
                this.cache.nextId = nextId;
                if (!this.cache.compactedIds) this.cache.compactedIds = [];
            }
        } catch (error: any) {
            this.logger?.warn(`读取文件失败: ${error.message}`);
            this.cache = { messages: [], thinks: {}, nextId: 1, compactedIds: [] };
        }
        return this.cache!;
    }

    private async writeThreadFile(file: ThreadFile): Promise<void> {
        const dir = dirname(this.filePath);
        if (!existsSync(dir)) await mkdir(dir, { recursive: true });
        await writeFile(this.filePath, JSON.stringify(file), "utf-8");
    }

    async pushMessage(message: ChatMessage, options?: ChatMessageOptions): Promise<void> {
        const file = await this.getFile();
        const id = file.nextId ?? 1;
        file.nextId = id + 1;
        file.messages.push({ id, message, createdAt: Math.floor(Date.now() / 1000), thinkId: options?.thinkId });

        const compactedSet = new Set(file.compactedIds);
        const nonCompacted = file.messages.filter(m => !compactedSet.has(m.id!));
        if (nonCompacted.length > 1000) {
            for (const m of nonCompacted.slice(0, nonCompacted.length - 1000)) {
                compactedSet.add(m.id!);
            }
            file.compactedIds = [...compactedSet];
        }

        await this.writeThreadFile(file);
    }

    async getAllMessages(): Promise<StoredMessage[]> {
        const file = await this.getFile();
        const compactedSet = new Set(file.compactedIds);
        return file.messages.filter(m => !compactedSet.has(m.id!));
    }

    async getMessages(): Promise<ChatMessage[]> {
        return (await this.getAllMessages()).map((r) => r.message);
    }

    async applyCompaction(compactedIds: number[], summary: StoredMessage): Promise<void> {
        if (compactedIds.length === 0) return;
        const file = await this.getFile();
        const compactedSet = new Set(file.compactedIds);
        for (const id of compactedIds) compactedSet.add(id);
        file.compactedIds = [...compactedSet];
        const id = file.nextId ?? 1;
        file.nextId = id + 1;
        file.messages.push({ ...summary, id });
        await this.writeThreadFile(file);
    }

    async searchMessages(query: string, limit: number = 20): Promise<StoredMessage[]> {
        const file = await this.getFile();
        const lower = query.toLowerCase();
        return file.messages
            .filter(m => {
                const c = m.message.content;
                return (typeof c === 'string' ? c : JSON.stringify(c)).toLowerCase().includes(lower);
            })
            .slice(-limit);
    }

    async clearMessages(): Promise<void> {
        this.cache = undefined;
        if (existsSync(this.filePath)) {
            await unlink(this.filePath);
        }
    }

    async getThink(thinkId: string): Promise<StoredMessage[]> {
        return (await this.getFile()).thinks?.[thinkId] ?? [];
    }

    async pushThinkMessage(thinkId: string, message: ChatMessage, options?: ChatMessageOptions): Promise<void> {
        const file = await this.getFile();
        if (!file.thinks) file.thinks = {};
        const existing = file.thinks[thinkId] ?? [];
        existing.push({ message, createdAt: Math.floor(Date.now() / 1000), thinkId: options?.thinkId });
        file.thinks[thinkId] = existing;
        await this.writeThreadFile(file);
    }

    async getMetadata(key: string): Promise<string | undefined> {
        return (await this.getFile()).metadata?.[key];
    }

    async setMetadata(key: string, value: string): Promise<void> {
        const file = await this.getFile();
        if (!file.metadata) file.metadata = {};
        file.metadata[key] = value;
        await this.writeThreadFile(file);
    }

    async dispose(): Promise<void> {}
}
