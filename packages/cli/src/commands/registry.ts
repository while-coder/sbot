import type { Command, CommandContext, CommandMatch } from './types.js';
import type { AppStateStore } from '../store/AppStateStore.js';
import { matchCommands } from './matcher.js';

export class CommandRegistry {
  private commands = new Map<string, Command>();

  register(command: Command): void {
    this.commands.set(command.name, command);
  }

  unregister(name: string): void {
    this.commands.delete(name);
  }

  getAll(): Command[] {
    return [...this.commands.values()];
  }

  match(input: string): CommandMatch[] {
    return matchCommands(this.getAll(), input);
  }

  async execute(input: string, store: AppStateStore): Promise<boolean> {
    const trimmed = input.startsWith('/') ? input.slice(1) : input;
    const parts = trimmed.split(/\s+/);
    const args = parts.slice(1).join(' ');

    const matches = this.match(input);
    const exact = matches.find(m => m.matchType === 'exact' || m.matchType === 'alias');
    if (!exact) return false;

    const ctx: CommandContext = { store, args, rawInput: input };
    await exact.command.handler(ctx);
    return true;
  }
}
