import { Command as CommanderCommand } from "commander";
import { UserServiceBase } from "./UserServiceBase";

/**
 * 命令执行上下文（内部使用）
 */
export interface CommandContext {
    args: any;
    userService: UserServiceBase;
    onResult?: (result: string) => void;  // 回调函数，用于返回结果
}

/**
 * 参数元数据
 */
interface ArgMetadata {
    propertyKey: string;
    name: string;
    description: string;
    required: boolean;
    parser?: (value: string) => any;
    defaultValue?: any;
}

/**
 * 选项元数据
 */
interface OptionMetadata {
    propertyKey: string;
    flags: string;
    description: string;
    parser?: (value: string, previous?: any) => any;
    defaultValue?: any;
}

/**
 * 命令元数据
 */
interface CommandMetadata {
    name: string;
    description: string;
    args: ArgMetadata[];
    options: OptionMetadata[];
}

// 存储装饰器元数据
const commandMetadataMap = new WeakMap<any, CommandMetadata>();
const argMetadataMap = new WeakMap<any, ArgMetadata[]>();
const optionMetadataMap = new WeakMap<any, OptionMetadata[]>();

/**
 * @Command 装饰器 - 定义命令
 * @param name 命令名称
 * @param description 命令描述
 */
export function Command(name: string, description: string) {
    return function <T extends { new(...args: any[]): {} }>(constructor: T) {
        const metadata: CommandMetadata = {
            name,
            description,
            args: argMetadataMap.get(constructor.prototype) || [],
            options: optionMetadataMap.get(constructor.prototype) || []
        };
        commandMetadataMap.set(constructor.prototype, metadata);
        return constructor;
    };
}

/**
 * 内置 Parser 辅助函数
 */
export const Parsers = {
    /**
     * 整数解析器
     */
    int: (v: string) => {
        const num = parseInt(v);
        if (isNaN(num)) {
            throw new Error(`Invalid integer: ${v}`);
        }
        return num;
    },

    /**
     * 浮点数解析器
     */
    float: (v: string) => {
        const num = parseFloat(v);
        if (isNaN(num)) {
            throw new Error(`Invalid float: ${v}`);
        }
        return num;
    },

    /**
     * 数字解析器（自动选择 int 或 float）
     */
    number: (v: string) => {
        const num = v.includes('.') ? parseFloat(v) : parseInt(v);
        if (isNaN(num)) {
            throw new Error(`Invalid number: ${v}`);
        }
        return num;
    },

    /**
     * 布尔解析器
     */
    boolean: (v: string) => {
        const lower = v.toLowerCase();
        if (['true', '1', 'yes', 'on'].includes(lower)) return true;
        if (['false', '0', 'no', 'off'].includes(lower)) return false;
        throw new Error(`Invalid boolean: ${v}`);
    },

    /**
     * 日期解析器
     */
    date: (v: string) => {
        const date = new Date(v);
        if (isNaN(date.getTime())) {
            throw new Error(`Invalid date: ${v}`);
        }
        return date;
    },

    /**
     * 枚举解析器工厂
     */
    enum: <T extends string>(values: readonly T[], caseSensitive = false): ((v: string) => T) => {
        return (v: string) => {
            const match = caseSensitive
                ? values.find(val => val === v)
                : values.find(val => val.toLowerCase() === v.toLowerCase());

            if (!match) {
                throw new Error(`Invalid value: ${v}. Must be one of: ${values.join(', ')}`);
            }
            return match;
        };
    },

    /**
     * 数组解析器工厂（逗号分隔）
     */
    array: (separator = ',') => {
        return (v: string) => v.split(separator).map(s => s.trim()).filter(s => s.length > 0);
    },

    /**
     * JSON 解析器
     */
    json: <T = any>(v: string): T => {
        try {
            return JSON.parse(v);
        } catch (e) {
            throw new Error(`Invalid JSON: ${v}`);
        }
    }
};

/**
 * @Arg 装饰器 - 定义参数
 * @param name 参数名称（可选，默认使用属性名）
 * @param options 选项配置
 */
export function Arg(
    name?: string,
    options?: {
        description?: string;
        required?: boolean;
        parser?: (value: string) => any;
        default?: string;  // 默认值统一为 string
    }
) {
    return function (target: any, propertyKey: string) {
        const args = argMetadataMap.get(target) || [];

        args.push({
            propertyKey,
            name: name || propertyKey,
            description: options?.description || propertyKey,
            required: options?.required !== false,
            parser: options?.parser,
            defaultValue: options?.default
        });
        argMetadataMap.set(target, args);
    };
}

/**
 * @Option 装饰器 - 定义选项
 * @param flags 选项标志，支持以下格式：
 *   - 数组: ['-f', '--force'] 或 ['--verbose'] 或 ['-c', '--count <n>']
 *   - 空: 默认使用 '--propertyName'
 * @param options 选项配置
 *
 * 注意：无论 flags 如何定义，都会自动添加 --propertyName 作为别名，
 * 这样在 cmd.action 中可以直接用属性名访问，无需转换
 */
export function Option(
    flags?: string[],
    options?: {
        description?: string;
        parser?: (value: string, previous?: any) => any;
        default?: string;  // 默认值统一为 string
    }
) {
    return function (target: any, propertyKey: string) {
        let finalFlags: string;

        if (!flags || flags.length === 0) {
            // 没有指定 flags，只使用属性名
            finalFlags = `--${propertyKey}`;
        } else {
            const flagsList = [...flags];

            // 检查是否存在带值的选项（<xxx> 或 [xxx]）
            let valuePattern = '';
            for (const flag of flagsList) {
                const match = flag.match(/<[^>]+>|\[[^\]]+\]/);
                if (match) {
                    valuePattern = match[0];
                    break;
                }
            }

            // 检查是否已经包含 --propertyName（忽略值部分）
            const hasPropertyName = flagsList.some(flag => {
                // 提取选项的基础名称（去掉 <xxx> 或 [xxx]）
                const baseFlag = flag.trim().split(/\s+/)[0];
                return baseFlag === `--${propertyKey}`;
            });

            // 只有在没有找到属性名对应的长选项时才添加
            if (!hasPropertyName) {
                const propertyFlag = valuePattern
                    ? `--${propertyKey} ${valuePattern}`
                    : `--${propertyKey}`;
                flagsList.push(propertyFlag);
            }

            finalFlags = flagsList.join(', ');
        }

        const opts = optionMetadataMap.get(target) || [];
        opts.push({
            propertyKey,
            flags: finalFlags,
            description: options?.description || propertyKey,
            parser: options?.parser,
            defaultValue: options?.default
        });
        optionMetadataMap.set(target, opts);
    };
}

/**
 * 命令基类
 */
export abstract class CommandBase {
    /**
     * 执行命令（子类实现）
     * 不需要 context 参数，子类可以直接访问 this.userId
     */
    abstract execute(): Promise<string>;

    /**
     * 原始参数（自动注入，内部使用）
     */
    protected _context!: CommandContext;
    /**
     * 用户 ID
     */
    protected get userId():string { return this._context.userService.userId }

    /**
     * 注册命令到 Commander（内部使用）
     */
    static register(instance: CommandBase, program: CommanderCommand, context: CommandContext): void {
        const metadata = commandMetadataMap.get(Object.getPrototypeOf(instance));
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
        cmd.action(async (...args) => {
            // 注入 context
            instance._context = context;

            // Commander 传递参数顺序: arg1, arg2, ..., options, command
            // 倒数第二个是 options 对象
            const options = args[args.length - 2] || {};
            console.log(options)
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
}