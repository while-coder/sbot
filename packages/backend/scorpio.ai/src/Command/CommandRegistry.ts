import { Command as CommanderCommand } from "commander";
import {
    ICommand,
    CommandContext,
    getCommandMetadata
} from "./CommandDecorators";

/**
 * 命令注册器
 * 提供命令注册和命令行解析的工具方法
 */
export class CommandRegistry {
    /**
     * 注册命令到 Commander
     * @param instance 命令实例
     * @param program Commander 程序实例
     * @param context 命令上下文
     */
    static register(instance: ICommand, program: CommanderCommand, context: CommandContext): void {
        const metadata = getCommandMetadata(Object.getPrototypeOf(instance));
        if (!metadata) {
            throw new Error('Command metadata not found. Did you forget @Command decorator?');
        }

        const cmd = program
            .command(metadata.name)
            .description(metadata.description);

        // 注册参数
        for (const arg of metadata.args) {
            const argName = arg.required
                ? `<${arg.name}>`
                : `[${arg.name}]`;

            // 必需参数不能有默认值
            if (arg.required) {
                if (arg.parser) {
                    cmd.argument(argName, arg.description, arg.parser);
                } else {
                    cmd.argument(argName, arg.description);
                }
            } else {
                // 可选参数可以有默认值
                if (arg.parser) {
                    cmd.argument(argName, arg.description, arg.parser, arg.defaultValue);
                } else {
                    cmd.argument(argName, arg.description, arg.defaultValue);
                }
            }
        }

        // 注册选项
        for (const opt of metadata.options) {
            if (opt.parser) {
                cmd.option(opt.flags, opt.description, opt.parser, opt.defaultValue);
            } else {
                cmd.option(opt.flags, opt.description, opt.defaultValue);
            }
        }

        // 直接在 action 中执行命令
        cmd.action(async (...args: any[]) => {
            // 注入 context
            instance._context = context;

            // Commander 传递参数顺序: arg1, arg2, ..., options, command
            // 倒数第二个是 options 对象
            const options = args[args.length - 2] || {};

            const actualArgs = args.slice(0, metadata.args.length);

            // 注入参数到实例属性
            metadata.args.forEach((arg, index) => {
                (instance as any)[arg.propertyKey] = actualArgs[index] ?? arg.defaultValue;
            });

            // 注入选项到实例属性
            // 由于我们始终添加了 --propertyName 别名，可以直接用属性名访问
            metadata.options.forEach((opt) => {
                (instance as any)[opt.propertyKey] = options[opt.propertyKey] ?? opt.defaultValue;
            });

            // 执行命令并通过回调返回结果
            const result = await instance.execute();
            if (context.onResult) {
                context.onResult(result);
            }
        });
    }

    /**
     * 解析命令行字符串为参数数组
     * 支持引号内的空格
     * @param commandLine 命令行字符串
     * @returns 解析后的参数数组
     *
     * @example
     * ```ts
     * CommandRegistry.parse('command "arg with spaces" --flag')
     * // => ['command', 'arg with spaces', '--flag']
     * ```
     */
    static parse(commandLine: string): string[] {
        const args: string[] = [];
        let current = '';
        let inQuote = false;
        let quoteChar = '';

        for (let i = 0; i < commandLine.length; i++) {
            const char = commandLine[i];

            if ((char === '"' || char === "'") && !inQuote) {
                inQuote = true;
                quoteChar = char;
            } else if (char === quoteChar && inQuote) {
                inQuote = false;
                quoteChar = '';
            } else if (char === ' ' && !inQuote) {
                if (current) {
                    args.push(current);
                    current = '';
                }
            } else {
                current += char;
            }
        }

        if (current) {
            args.push(current);
        }

        return args;
    }
}