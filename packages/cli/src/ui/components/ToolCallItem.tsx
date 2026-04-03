import React, { useState, useCallback } from 'react';
import { Box, Text } from 'ink';
import { theme } from '../colors.js';
import { useKeypress, type Key } from '../hooks/useKeypress.js';

interface ToolCallItemProps {
  name: string;
  args: unknown;
  result?: string;
  isInputActive: boolean;
}

export const ToolCallItem: React.FC<ToolCallItemProps> = ({ name, args, result, isInputActive }) => {
  const [expanded, setExpanded] = useState(false);

  const handleKeypress = useCallback(
    (key: Key) => {
      if (key.name === 'tab') {
        setExpanded((e) => !e);
      }
    },
    [],
  );

  // Only handle Tab when input is active (idle state)
  useKeypress(handleKeypress, { isActive: isInputActive });

  const argsText = typeof args === 'string' ? args : JSON.stringify(args, null, 2);

  return (
    <Box flexDirection="column" marginY={0}>
      <Text color={theme.status.warning}>
        {expanded ? '▼' : '▶'} [tool_call] {name}
        {result ? ' ✓' : ''}
      </Text>
      {expanded && (
        <Box flexDirection="column" marginLeft={2} marginBottom={1}>
          <Text color={theme.text.muted} bold>Args:</Text>
          <Text color={theme.text.muted}>{argsText}</Text>
          {result && (
            <>
              <Text color={theme.status.success} bold>Result:</Text>
              <Text color={theme.text.muted}>{result}</Text>
            </>
          )}
        </Box>
      )}
    </Box>
  );
};
