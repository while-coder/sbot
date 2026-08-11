/**
 * Command 系统入口
 */

export {
    Command,
    Arg,
    Option,
    Parsers,
    ICommand,
    CommandContext,
    getCommandMetadata,
} from './CommandDecorators';
export type { CommandMetadata, ArgMetadata, OptionMetadata } from './CommandDecorators';

export { CommandRegistry } from './CommandRegistry';
