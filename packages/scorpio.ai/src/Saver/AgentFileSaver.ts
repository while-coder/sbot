import { readFile, writeFile, unlink, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { dirname } from "path";
import { IAgentSaverService, ChatMessage, StoredMessage, ChatMessageOptions } from "./IAgentSaverService";
import { ILoggerService, ILogger } from "../Logger";
import { inject } from "scorpio.di";
import { T_DBPath } from "../Core/tokens";
import { applyTokenLimit } from "./messageSerializer";

interface ThreadFile {
    messages: StoredMessage[];
    thinks?: Record<string, StoredMessage[]>;
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
                this.cache = { messages: [], thinks: {} };
            } else {
                const content = await readFile(this.filePath, "utf-8");
                this.cache = JSON.parse(content) as ThreadFile;
            }
        } catch (error: any) {
            this.logger?.warn(`读取文件失败: ${error.message}`);
            this.cache = { messages: [], thinks: {} };
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
        const thinks = file.thinks ?? {};

        file.messages.push({ message, createdAt: Math.floor(Date.now() / 1000), thinkId: options?.thinkId });

        // trim: keep last 1000, clean up orphaned thinks
        if (file.messages.length > 1000) {
            const removed = file.messages.splice(0, file.messages.length - 1000);
            for (const row of removed) {
                if (row.thinkId) delete thinks[row.thinkId];
            }
        }

        file.thinks = thinks;
        await this.writeThreadFile(file);
    }

    async getAllMessages(): Promise<StoredMessage[]> {
        return (await this.getFile()).messages;
    }

    async getMessages(maxTokens: number): Promise<ChatMessage[]> {
        return applyTokenLimit((await this.getAllMessages()).map((r) => r.message), maxTokens);
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

    async dispose(): Promise<void> {}
}
