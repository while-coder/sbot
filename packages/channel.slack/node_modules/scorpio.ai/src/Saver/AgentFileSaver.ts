import { readFile, writeFile, readdir, unlink, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { BaseMessage } from "langchain";
import { IAgentSaverService } from "./IAgentSaverService";
import { ILoggerService, ILogger } from "../Logger";
import { inject } from "../DI";
import { T_DBPath, T_ThreadId } from "../Core/tokens";
import { MessageType, serializeMessage, deserializeMessage, applyTokenLimit } from "./messageSerializer";

type ThreadRows = Array<{ type: string; data: string; created_at?: number }>;

// ─────────────────────────────────────────────────────────────────────────────
// AgentFileSaver
// 每个 thread 独立存储为 {dir}/{threadId}.json
// ─────────────────────────────────────────────────────────────────────────────

export class AgentFileSaver implements IAgentSaverService {
    private logger?: ILogger;

    readonly threadId: string;
    private readonly dir: string;

    constructor(
        @inject(T_ThreadId) threadId: string,
        @inject(T_DBPath) dir: string,
        @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService
    ) {
        this.threadId = threadId;
        this.dir = dir;
        this.logger = loggerService?.getLogger("AgentFileSaver");
    }

    private threadFile(threadId: string): string {
        return join(this.dir, `${threadId}.json`);
    }

    private async ensureDir(): Promise<void> {
        if (!existsSync(this.dir)) {
            await mkdir(this.dir, { recursive: true });
        }
    }

    private async readRows(threadId: string): Promise<ThreadRows> {
        const file = this.threadFile(threadId);
        try {
            if (!existsSync(file)) return [];
            const content = await readFile(file, "utf-8");
            return JSON.parse(content) as ThreadRows;
        } catch (error: any) {
            this.logger?.warn(`读取线程文件失败: ${error.message}`);
            return [];
        }
    }

    private async writeRows(threadId: string, rows: ThreadRows): Promise<void> {
        await this.ensureDir();
        await writeFile(this.threadFile(threadId), JSON.stringify(rows), "utf-8");
    }

    /**
     * 向当前线程追加一条消息
     */
    async pushMessage(message: BaseMessage): Promise<void> {
        const rows = await this.readRows(this.threadId);
        const { type, data } = serializeMessage(message);
        rows.push({ type, data, created_at: Math.floor(Date.now() / 1000) });

        // 超过 1000 条时删除较早的记录
        if (rows.length > 1000) {
            rows.splice(0, rows.length - 1000);
        }

        await this.writeRows(this.threadId, rows);
    }

    /**
     * 获取当前线程的全部历史消息（不限制 token）
     */
    async getAllMessages(): Promise<BaseMessage[]> {
        const rows = await this.readRows(this.threadId);
        return rows.map((r) => {
            const msg = deserializeMessage(r.type as MessageType, r.data);
            if (r.created_at) {
                msg.additional_kwargs = { ...msg.additional_kwargs, created_at: r.created_at };
            }
            return msg;
        });
    }

    /**
     * 获取当前线程的历史消息，从末尾截取不超过 maxTokens 的部分
     * 确保不破坏 tool_calls 和 ToolMessage 的配对
     */
    async getMessages(maxTokens: number): Promise<BaseMessage[]> {
        return applyTokenLimit(await this.getAllMessages(), maxTokens);
    }

    /**
     * 清除当前线程的所有历史记录
     */
    async clearMessages(): Promise<void> {
        const file = this.threadFile(this.threadId);
        if (existsSync(file)) {
            await unlink(file);
        }
    }

    /**
     * 获取所有线程 ID 列表
     */
    async getAllThreadIds(): Promise<string[]> {
        try {
            if (!existsSync(this.dir)) return [];
            const files = await readdir(this.dir);
            return files
                .filter((f) => f.endsWith(".json"))
                .map((f) => f.slice(0, -5))
                .sort();
        } catch (error: any) {
            this.logger?.warn(`读取线程目录失败: ${error.message}`);
            return [];
        }
    }

    /**
     * 释放资源
     */
    async dispose(): Promise<void> {
        // 文件实现无需释放资源
    }
}
