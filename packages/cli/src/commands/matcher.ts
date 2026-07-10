import type { Command, CommandMatch } from './types.js';

export function matchCommands(commands: Command[], input: string): CommandMatch[] {
  const trimmed = input.startsWith('/') ? input.slice(1) : input;
  const query = trimmed.split(/\s/)[0].toLowerCase();
  if (!query) {
    return commands
      .map(command => ({ command, score: 2, matchType: 'prefix' as const }))
      .sort((a, b) => a.command.name.localeCompare(b.command.name));
  }

  const results: CommandMatch[] = [];

  for (const cmd of commands) {
    if (cmd.name === query) {
      results.push({ command: cmd, score: 0, matchType: 'exact' });
      continue;
    }
    if (cmd.aliases?.includes(query)) {
      results.push({ command: cmd, score: 1, matchType: 'alias' });
      continue;
    }
    if (cmd.name.startsWith(query)) {
      results.push({ command: cmd, score: 2, matchType: 'prefix' });
      continue;
    }
    if (cmd.aliases?.some(a => a.startsWith(query))) {
      results.push({ command: cmd, score: 3, matchType: 'alias' });
    }
  }

  return results.sort((a, b) => a.score - b.score || a.command.name.localeCompare(b.command.name));
}
