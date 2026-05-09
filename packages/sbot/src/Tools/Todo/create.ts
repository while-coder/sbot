import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { database, SchedulerRow } from '../../Core/Database';
import { schedulerService } from '../../Scheduler/SchedulerService';
import { LoggerService } from '../../Core/LoggerService';
import { loadPrompt } from '../../Core/PromptLoader';
import { TODO_CREATE_TOOL_NAME } from './index';

const logger = LoggerService.getLogger('Tools/Todo/create.ts');

function deadlineToCron(deadline: Date): string {
    const s = deadline.getSeconds();
    const m = deadline.getMinutes();
    const h = deadline.getHours();
    const d = deadline.getDate();
    const mo = deadline.getMonth() + 1;
    return `${s} ${m} ${h} ${d} ${mo} *`;
}

export function createTodoCreateTool(targetId: string): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: TODO_CREATE_TOOL_NAME,
        description: loadPrompt('tools/todo/create.txt'),
        schema: z.object({
            content: z.string().describe('Task description'),
            priority: z.enum(['low', 'normal', 'high']).optional().describe('Priority level (default: normal)'),
            deadline: z.string().optional().describe('Deadline as ISO 8601 datetime string, e.g. "2026-04-25T18:00:00"'),
        }) as any,
        func: async ({ content, priority, deadline }: any): Promise<MCPToolResult> => {
            try {
                if (!content?.trim()) return createErrorResult('content is required');

                const now = Date.now();
                let deadlineMs: number | null = null;
                if (deadline) {
                    deadlineMs = new Date(deadline).getTime();
                    if (isNaN(deadlineMs)) return createErrorResult(`Invalid deadline: ${deadline}`);
                    if (deadlineMs <= now) return createErrorResult('Deadline must be in the future');
                }

                const row = await database.create<any>(database.todo, {
                    targetId,
                    content: content.trim(),
                    status: 'pending',
                    priority: priority || 'normal',
                    deadline: deadlineMs,
                    schedulerId: null,
                    doneAt: null,
                    createdAt: now,
                });

                const todoId = row.id;
                let deadlineInfo = '';

                if (deadlineMs) {
                    const deadlineDate = new Date(deadlineMs);
                    const cronExpr = deadlineToCron(deadlineDate);
                    const schedulerRow = await database.create<SchedulerRow>(database.scheduler, {
                        targetId,
                        expr: cronExpr,
                        message: `[Todo Reminder] #${todoId}: ${content.trim()}`,
                        lastRun: null,
                        runCount: 0,
                        maxRuns: 1,
                    });
                    const schedulerId = (schedulerRow as any).id;
                    await database.update(database.todo, { schedulerId }, { where: { id: todoId } });
                    await schedulerService.reload(schedulerId);
                    deadlineInfo = `\n  deadline: ${deadlineDate.toLocaleString()}`;
                }

                const prioLabel = priority || 'normal';
                return createSuccessResult(createTextContent(
                    `Created todo #${todoId} [${prioLabel}]: ${content.trim()}${deadlineInfo}`,
                ));
            } catch (e: any) {
                logger.error(`todo_create failed: ${e.message}`);
                return createErrorResult(`Failed to create todo: ${e.message}`);
            }
        },
    });
}
