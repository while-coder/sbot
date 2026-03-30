import { readFile, writeFile, unlink, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { dirname } from "path";
import { BaseMessage } from "langchain";
import { IAgentSaverService, SaverMessage } from "./IAgentSaverService";
import { ILoggerService, ILogger } from "../Logger";
import { inject } from "scorpio.di";
import { T_DBPath } from "../Core/tokens";
import { MessageType, serializeMessage, deserializeMessage, applyTokenLimit } from "./messageSerializer";

type ThreadRow = { type: string; data: string; created_at?: number };
type ThreadRows = Array<ThreadRow>;
interface ThreadFile {
    messages: ThreadRows;
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

    private async readRows(): Promise<ThreadRows> {
        try {
            if (!existsSync(this.filePath)) return [];
            const content = await readFile(this.filePath, "utf-8");
            const parsed = JSON.parse(content);
            if (Array.isArray(parsed)) return parsed as ThreadRows;
            return (parsed as ThreadFile).messages ?? [];
        } catch (error: any) {
            this.logger?.warn(`读取文件失败: ${error.message}`);
            return [];
        }
    }

    private async writeRows(rows: ThreadRows): Promise<void> {
        await this.ensureDir();
        const file: ThreadFile = { messages: rows };
        await writeFile(this.filePath, JSON.stringify(file), "utf-8");
    }

    async pushMessage(message: BaseMessage): Promise<void> {
        const rows = await this.readRows();
        const { type, data } = serializeMessage(message);
        rows.push({ type, data, created_at: Math.floor(Date.now() / 1000) });

        if (rows.length > 1000) {
            rows.splice(0, rows.length - 1000);
        }

        await this.writeRows(rows);
    }

    async getAllMessages(): Promise<BaseMessage[]> {
        return (await this.getAllMessagesWithTime()).map((r) => r.message);
    }

    async getAllMessagesWithTime(): Promise<SaverMessage[]> {
        const rows = await this.readRows();
        return rows.map((r) => ({
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

    async dispose(): Promise<void> {}
}
