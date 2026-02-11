import { Command, Arg, Option, Parsers, CommandContext, ICommand } from "scorpio.ai"
import { IAgentSaverService, AgentSqliteSaver, MemoryService, EmbeddingServiceFactory } from "scorpio.ai";
import { config } from "../Config";

/**
 * /clear 命令 - 清除历史记录或长期记忆
 *
 * 使用示例:
 * /clear history   - 清除对话历史
 * /clear memory    - 清除长期记忆
 */
@Command('clear', '清除历史记录或长期记忆')
export class ClearCommand implements ICommand {
    _context!: CommandContext;
    @Arg('type', {
        description: '清除类型: history(历史记录) 或 memory(长期记忆)',
        parser: Parsers.enum(['history', 'memory'] as const)
    })
    type!: 'history' | 'memory';

    async execute(): Promise<string> {
        const userService = this._context.context;
        if (!userService) {
            return '无法访问用户服务';
        }

        const userId = userService.userId;

        if (this.type === 'history') {
            const agentSaver: IAgentSaverService = new AgentSqliteSaver(config.getUserSaverPath(userId));
            await agentSaver.clearThread(userId);
            await agentSaver.dispose();
            return `已清除用户 ${userId} 的对话历史`;
        } else if (this.type === 'memory') {
            // memory
            const memoryConfig = config.settings.memory;
            if (!memoryConfig?.enabled || !memoryConfig?.embedding) {
                return '记忆功能未启用';
            }
            const embeddingConfig = config.getEmbedding(memoryConfig.embedding);
            if (!embeddingConfig) return `Embedding 配置 "${memoryConfig.embedding}" 不存在`;
            const embeddingService = await EmbeddingServiceFactory.getEmbeddingService(embeddingConfig as any);
            const memoryService = new MemoryService(
                userId,
                config.getUserMemoryPath(userId),
                embeddingService,
            );
            const count = await memoryService.clearAll();
            await memoryService.dispose();
            return `已清除用户 ${userId} 的 ${count} 条长期记忆`;
        } else {
            return `未知的清除类型: ${this.type}`;
        }
    }
}

/**
 * /test 命令 - 测试所有装饰器功能
 *
 * 使用示例:
 * /test "hello"
 * /test "hello" 42
 * /test "hello" 42 -v
 * /test "hello" 42 -v --count 5
 * /test "hello" 42 --verbose --count 5 --mode debug
 * /test "hello" 42 -v -c 5 -m release --tags "a,b,c"
 */
@Command('test', '测试命令 - 验证所有装饰器功能')
export class TestCommand implements ICommand {
    _context!: CommandContext;
    // 必需的字符串参数
    @Arg('message', { description: '消息内容' })
    message!: string;

    // 可选的整数参数（带默认值）
    @Arg('number', {
        description: '数字参数',
        required: false,
        parser: Parsers.int,
        default: '10'
    })
    number!: number;

    // 布尔选项（短选项 + 长选项）
    @Option(['-v', '--verbose'], { description: '详细输出' })
    verbose!: boolean;

    // 带值的整数选项
    @Option(['-c', '--count <n>'], {
        description: '重复次数',
        parser: Parsers.int,
        default: '1'
    })
    count!: number;

    // 枚举选项
    @Option(['-m', '--mode <mode>'], {
        description: '模式（debug/release）',
        parser: Parsers.enum(['debug', 'release'] as const),
        default: 'debug'
    })
    mode!: 'debug' | 'release';

    // 数组选项
    @Option(['-t', '--tags <list>'], {
        description: '标签列表（逗号分隔）',
        parser: Parsers.array()
    })
    tags?: string[];

    // 浮点数选项
    @Option(['--timeout <ms>'], {
        description: '超时时间（秒）',
        parser: Parsers.float,
        default: '3.5'
    })
    timeout!: number;

    // 使用默认字段名的选项
    @Option()
    force!: boolean;

    // 否定选项
    @Option(['--no-color'], { description: '禁用颜色' })
    color!: boolean;

    async execute(): Promise<string> {
        const result: string[] = [
            '🧪 测试命令执行结果',
            '',
            '📝 参数 (Arguments):',
            `  message: "${this.message}"`,
            `  number: ${this.number} (${typeof this.number})`,
            '',
            '⚙️ 选项 (Options):',
            `  verbose (-v, --verbose): ${this.verbose}`,
            `  count (-c, --count): ${this.count} (${typeof this.count})`,
            `  mode (-m, --mode): "${this.mode}"`,
            `  tags (-t, --tags): ${this.tags ? `[${this.tags.join(', ')}]` : 'undefined'}`,
            `  timeout (--timeout): ${this.timeout} (${typeof this.timeout})`,
            `  force (--force): ${this.force}`,
            `  color (--no-color): ${this.color}`,
            '',
            '👤 上下文:',
            `  userId: ${this._context.context?.userId || 'unknown'}`,
            '',
        ];

        // 如果 verbose 模式，输出处理后的消息
        if (this.verbose) {
            result.push('🔍 详细信息:');
            result.push(`  消息处理: ${this.message.toUpperCase()}`);
            result.push(`  重复 ${this.count} 次: ${this.message.repeat(this.count)}`);
            result.push(`  模式标记: [${this.mode.toUpperCase()}]`);
            result.push('');
        }

        result.push('✅ 测试完成！所有参数和选项解析正确');

        return result.join('\n');
    }
}


/**
 * 获取所有内置命令
 */
export function getBuiltInCommands(): ICommand[] {
    return [
        new ClearCommand(),
        new TestCommand(),
    ];
}
