import type { AppStateStore } from '../store/AppStateStore.js';

export interface Command {
  name: string;
  description: string;
  aliases?: string[];
  type: 'local' | 'prompt';
  handler: (ctx: CommandContext) => void | Promise<void>;
}

export interface CommandContext {
  store: AppStateStore;
  args: string;
  rawInput: string;
}

export interface CommandMatch {
  command: Command;
  score: number;
  matchType: 'exact' | 'prefix' | 'alias';
}
