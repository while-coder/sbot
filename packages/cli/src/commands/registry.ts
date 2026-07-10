import type { Command, CommandContext, CommandMatch } from './types.js';
import type { AppStateStore } from '../store/AppStateStore.js';
import { matchCommands } from './matcher.js';

export class CommandRegistry {
  private localCommands = new Map<string, Command>();
  private promptCommands = new Map<string, Command>();

  register(command: Command): void {
    const target = command.type === 'prompt' ? this.promptCommands : this.localCommands;
    target.set(command.name, command);
  }

  replacePromptCommands(commands: Command[]): void {
    this.promptCommands.clear();
    for (const command of commands) {
      if (command.type === 'prompt') this.promptCommands.set(command.name, command);
    }
  }

  unregister(name: string): void {
    this.localCommands.delete(name);
    this.promptCommands.delete(name);
  }

  getAll(): Command[] {
    const merged = new Map(this.localCommands);
    for (const [name, command] of this.promptCommands) merged.set(name, command);
    return [...merged.values()];
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
    if (exact.command.type === 'prompt') return false;

    const ctx: CommandContext = { store, args, rawInput: input };
    await exact.command.handler(ctx);
    return true;
  }
}
