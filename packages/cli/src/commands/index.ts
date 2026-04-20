export type { Command, CommandContext, CommandMatch } from './types.js';
export { CommandRegistry } from './registry.js';
export { matchCommands } from './matcher.js';
export {
  createHelpCommand,
  clearCommand,
  sessionCommand,
  createExitCommand,
  compactCommand,
  approveAllCommand,
} from './builtins/index.js';
