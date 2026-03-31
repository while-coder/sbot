import { readFile, writeFile, unlink, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { dirname } from "path";
import { BaseMessage } from "langchain";
import { IAgentSaverService, SaverMessage } from "./IAgentSaverService";
import { ILoggerService, ILogger } from "../Logger";
import { inject } from "scorpio.di";
import { T_DBPath } from "../Core/tokens";
import { MessageType, serializeMessage, deserializeMessage, applyTokenLimit, ThinkBlock } from "./messageSerializer";

type ThreadRow = { type: string; data: string; created_at?: number; thinkId?: string };
type ThreadRows = Array<ThreadRow>;
interface ThreadFile {
    messages: ThreadRows;
    thinks?: Record<string, ThreadRow[]>;
}

// ─────────────────────────────────────────────────────────────────────────────
// AgentFileSaver
// 直接读写指定的 JSON 文件
// ─────────────────────────────────────────────────────────────────────────────

export class AgentFileSaver implements IAgentSaverService {
    private logger?: ILogger;
    private readonly filePath: string;

    constructor(
        @inject(T_DBPath) filePath: string,
        @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService
    ) {
        this.filePath = filePath;
        this.logger = loggerService?.getLogger("AgentFileSaver");
    }

    private async ensureDir(): Promise<void> {
        const dir = dirname(this.filePath);
        if (!existsSync(dir)) {
            await mkdir(dir, { recursive: true });
        }
    }

    private async readFile(): Promise<ThreadFile> {
        try {
            if (!existsSync(this.filePath)) return { messages: [], thinks: {} };
            const content = await readFile(this.filePath, "utf-8");
            const parsed = JSON.parse(content);
            // compat: old format was bare array
            if (Array.isArray(parsed)) return { messages: parsed as ThreadRows, thinks: {} };
            return {
                messages: (parsed as ThreadFile).messages ?? [],
                thinks: (parsed as ThreadFile).thinks ?? {},
            };
        } catch (error: any) {
            this.logger?.warn(`读取文件失败: ${error.message}`);
            return { messages: [], thinks: {} };
        }
    }

    private async writeThreadFile(file: ThreadFile): Promise<void> {
        await this.ensureDir();
        await writeFile(this.filePath, JSON.stringify(file), "utf-8");
    }

    async pushMessage(message: BaseMessage): Promise<void> {
        const file = await this.readFile();
        const thinks = file.thinks ?? {};

        const additionalKwargs = (message as any).additional_kwargs;
        const thinkId = additionalKwargs?.thinkId as string | undefined;
        if (thinkId) delete additionalKwargs.thinkId;

        const { type, data } = serializeMessage(message);
        file.messages.push({ type, data, created_at: Math.floor(Date.now() / 1000), thinkId });

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

    async getAllMessages(): Promise<BaseMessage[]> {
        const file = await this.readFile();
        return file.messages.map((r: ThreadRow) =>
            deserializeMessage(r.type as MessageType, r.data)
        );
    }

    async getAllMessagesWithTime(): Promise<SaverMessage[]> {
        const file = await this.readFile();
        return file.messages.map((r: ThreadRow) => ({
            message: deserializeMessage(r.type as MessageType, r.data),
            createdAt: r.created_at,
        }));
    }

    async getMessages(maxTokens: number): Promise<BaseMessage[]> {
        return applyTokenLimit(await this.getAllMessages(), maxTokens);
    }

    async clearMessages(): Promise<void> {
        if (existsSync(this.filePath)) {
            await unlink(this.filePath);
        }
    }

    async getThink(thinkId: string): Promise<ThinkBlock[]> {
        const file = await this.readFile();
        const rows = file.thinks?.[thinkId] ?? [];
        return rows
            .filter((r) => r.type === "think")
            .map((r) => JSON.parse(r.data) as ThinkBlock);
    }

    async pushThinkMessages(thinkId: string, messages: BaseMessage[]): Promise<void> {
        const file = await this.readFile();
        const existing = file.thinks?.[thinkId] ?? [];
        const newRows: ThreadRow[] = messages.map((m) => {
            const { type, data } = serializeMessage(m);
            return { type, data, created_at: Math.floor(Date.now() / 1000) };
        });
        if (!file.thinks) file.thinks = {};
        file.thinks[thinkId] = [...existing, ...newRows];
        await this.writeThreadFile(file);
    }

    async dispose(): Promise<void> {}
}
