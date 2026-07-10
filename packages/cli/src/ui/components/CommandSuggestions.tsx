import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../colors.js';
import type { CommandMatch } from '../../commands/types.js';

const MAX_VISIBLE_COMMANDS = 5;

interface CommandSuggestionsProps {
  matches: CommandMatch[];
  selectedIndex: number;
}

export const CommandSuggestions: React.FC<CommandSuggestionsProps> = ({
  matches,
  selectedIndex,
}) => {
  if (matches.length === 0) return null;
  const startIndex = Math.min(
    Math.max(0, selectedIndex - MAX_VISIBLE_COMMANDS + 1),
    Math.max(0, matches.length - MAX_VISIBLE_COMMANDS),
  );
  const visible = matches.slice(startIndex, startIndex + MAX_VISIBLE_COMMANDS);

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={theme.text.muted} paddingX={1}>
      {visible.map((m, i) => {
        const focused = startIndex + i === selectedIndex;
        const aliases = m.command.aliases?.length
          ? ` (${m.command.aliases.map(alias => `/${alias}`).join(', ')})`
          : '';
        const usage = m.command.usage ? ` ${m.command.usage}` : '';
        return (
          <Box key={m.command.name}>
            <Text color={focused ? theme.text.accent : theme.text.primary} bold={focused}>
              {focused ? '> ' : '  '}/{m.command.name}{usage}{aliases}
            </Text>
            <Text color={theme.text.muted}>  {m.command.description}</Text>
          </Box>
        );
      })}
      <Text color={theme.text.muted}>
        {matches.length > MAX_VISIBLE_COMMANDS
          ? `${selectedIndex + 1}/${matches.length}  `
          : ''}
        ↑↓ 选择 · Tab 补全 · Enter 选择/执行 · Esc 关闭
      </Text>
    </Box>
  );
};
