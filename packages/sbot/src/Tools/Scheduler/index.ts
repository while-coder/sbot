/**
 * 调度工具集
 */

import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { database, SchedulerRow, SchedulerType } from '../../Core/Database';
import { schedulerService } from '../../Scheduler/SchedulerService';
import { LoggerService } from '../../Core/LoggerService';

const logger = LoggerService.getLogger('Tools/Scheduler/index.ts');

// ─────────────────────────────────────────────────────────────────────────────
// scheduler_list
// ─────────────────────────────────────────────────────────────────────────────

export function createSchedulerListTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'scheduler_list',
        description: '查询所有调度任务列表。返回每条记录的 id、name、expr、type、message、userId、sessionId、workPath、lastRun。',
        schema: z.object({}) as any,
        func: async (): Promise<MCPToolResult> => {
            try {
                const timers = await database.findAll<SchedulerRow>(database.scheduler);
                return createSuccessResult(createTextContent(JSON.stringify(timers, null, 2)));
            } catch (e: any) {
                logger.error(`scheduler_list 失败: ${e.message}`);
                return createErrorResult(`查询调度任务失败: ${e.message}`);
            }
        },
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// scheduler_create
// ─────────────────────────────────────────────────────────────────────────────

export function createSchedulerCreateTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'scheduler_create',
        description: `创建新调度任务，使用 cron 表达式指定触发时间（5 段：分 时 日 月 周）。常用示例：
- 每天 09:00        → "0 9 * * *"
- 每周一 09:00      → "0 9 * * 1"
- 每月 1 日 09:00   → "0 9 1 * *"
- 每隔 30 分钟      → "*/30 * * * *"
- 每小时整点        → "0 * * * *"`,
        schema: z.object({
            name:      z.string().describe('任务名称'),
            expr:      z.string().describe('cron 表达式，5 段格式：分 时 日 月 周'),
            type:      z.enum(Object.values(SchedulerType) as [string, ...string[]]).optional().describe(`任务类型：${Object.values(SchedulerType).join(' | ')}`),
            message:   z.string().describe('触发时发送给用户的消息文本'),
            userId:    z.number().optional().describe('Lark 用户的数据库 ID，对应 userInfo.dbUserId（user 表自增 id）；设置后任务通过 Lark 通道回复该用户'),
            sessionId: z.string().optional().describe('会话 ID；userId 未设置时使用此字段通过 HTTP 通道触发指定会话'),
            workPath:  z.string().optional().describe('工作目录路径；userId 未设置时使用此字段通过 HTTP 通道触发目录模式'),
        }) as any,
        func: async ({ name, expr, type, message, userId, sessionId, workPath }: any): Promise<MCPToolResult> => {
            try {
                if (!name?.trim())    return createErrorResult('name 不能为空');
                if (!expr?.trim())    return createErrorResult('expr 不能为空');
                if (!message?.trim()) return createErrorResult('message 不能为空');

                const row = await database.create<SchedulerRow>(database.scheduler, {
                    name:      name.trim(),
                    expr:      expr.trim(),
                    type:      type ?? null,
                    message:   message.trim(),
                    userId:    userId ?? null,
                    sessionId: sessionId ?? null,
                    workPath:  workPath ?? null,
                    lastRun:   null,
                });
                await schedulerService.reload((row as any).id);
                return createSuccessResult(createTextContent(`调度任务已创建:\n${JSON.stringify(row, null, 2)}`));
            } catch (e: any) {
                logger.error(`scheduler_create 失败: ${e.message}`);
                return createErrorResult(`创建调度任务失败: ${e.message}`);
            }
        },
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// scheduler_delete
// ─────────────────────────────────────────────────────────────────────────────

export function createSchedulerDeleteTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'scheduler_delete',
        description: '删除指定调度任务，同时取消其调度',
        schema: z.object({
            id: z.number().describe('任务 id'),
        }) as any,
        func: async ({ id }: any): Promise<MCPToolResult> => {
            try {
                const existing = await database.findByPk<SchedulerRow>(database.scheduler, id);
                if (!existing) return createErrorResult(`调度任务 id=${id} 不存在`);
                schedulerService.cancel(id);
                await database.destroy(database.scheduler, { where: { id } });
                return createSuccessResult(createTextContent(`调度任务 id=${id}（${existing.name}）已删除`));
            } catch (e: any) {
                logger.error(`scheduler_delete 失败: ${e.message}`);
                return createErrorResult(`删除调度任务失败: ${e.message}`);
            }
        },
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// 工具集合
// ─────────────────────────────────────────────────────────────────────────────

export function createSchedulerTools(): StructuredToolInterface[] {
    return [
        createSchedulerListTool(),
        createSchedulerCreateTool(),
        createSchedulerDeleteTool(),
    ];
}
