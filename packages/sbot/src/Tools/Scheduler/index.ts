/**
 * 调度工具集
 */

import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { database, SchedulerRow, ContextType } from '../../Core/Database';
import { schedulerService } from '../../Scheduler/SchedulerService';
import { LoggerService } from '../../Core/LoggerService';

const logger = LoggerService.getLogger('Tools/Scheduler/index.ts');

// ─────────────────────────────────────────────────────────────────────────────
// scheduler_list
// ─────────────────────────────────────────────────────────────────────────────

export function createSchedulerListTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'scheduler_list',
        description: '查询所有调度任务列表，返回每条记录的 id、name、expr、type、message、userId、sessionId、workPath、lastRun。创建或删除任务前可先调用此工具确认是否已存在同名任务，以及获取待删除任务的 id。',
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
        description: `创建调度任务，使用 5 段 cron 表达式（分 时 日 月 周）指定触发时间，时区与服务器一致。

常用 cron 示例：
- 每天 09:00        → "0 9 * * *"
- 每周一 09:00      → "0 9 * * 1"
- 每月 1 日 09:00   → "0 9 1 * *"
- 每隔 30 分钟      → "*/30 * * * *"
- 每小时整点        → "0 * * * *"

【路由配置——根据当前 conversation-type 三选一，其余路由字段留 null】
① conversation-type=channel（Lark 频道）
   → type="channel"，userId 填 <current-user> 中 <db-id> 的整数值
② conversation-type=session（HTTP 会话）
   → type="session"，sessionId 填 <environment> 中 <scheduler-session-id> 的值
③ conversation-type=directory（目录模式）
   → type="directory"，workPath 填 <environment><paths><working-directory> 的 dir 属性值`,
        schema: z.object({
            name:      z.string().describe('任务名称'),
            expr:      z.string().describe('cron 表达式，5 段格式：分 时 日 月 周'),
            type:      z.enum(Object.values(ContextType) as [string, ...string[]]).optional().describe(`路由类型，与路由字段严格对应：channel（配合 userId）| session（配合 sessionId）| directory（配合 workPath）`),
            message:   z.string().describe('触发时发送给用户的消息文本'),
            userId:    z.number().optional().describe('【仅 channel 模式】Lark 用户的数据库 ID，取自系统上下文 <current-user><db-id>，其他模式留 null'),
            sessionId: z.string().optional().describe('【仅 session 模式】会话 ID，取自系统上下文 <environment><scheduler-session-id>，其他模式留 null'),
            workPath:  z.string().optional().describe('【仅 directory 模式】工作目录绝对路径，取自系统上下文 <environment><paths><working-directory dir="..."> 的 dir 值，其他模式留 null'),
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
        description: '删除并取消指定调度任务。如不确定任务 id，请先调用 scheduler_list 查询后再传入。',
        schema: z.object({
            id: z.number().describe('要删除的任务 id，可通过 scheduler_list 获取'),
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
