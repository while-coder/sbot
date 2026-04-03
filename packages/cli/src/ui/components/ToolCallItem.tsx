import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../colors.js';

interface ToolCallItemProps {
  name: string;
  args: unknown;
  result?: string;
  expanded: boolean;
}

export const ToolCallItem: React.FC<ToolCallItemProps> = ({ name, args, result, expanded }) => {
  const argsText = typeof args === 'string' ? args : JSON.stringify(args, null, 2);

  // If args is an object with 1-2 keys, show inline on the header line
  const argsObj = (args && typeof args === 'object' && !Array.isArray(args)) ? args as Record<string, unknown> : null;
  const argsKeys = argsObj ? Object.keys(argsObj) : [];
  const inlineArgs = argsKeys.length > 0 && argsKeys.length <= 2
    ? argsKeys.map((k) => {
        let v = argsObj![k];
        let s = typeof v === 'string' ? v : JSON.stringify(v);
        if (s.length > 40) s = s.slice(0, 40) + '…';
        return `${k}=${s}`;
      }).join(' ')
    : '';

  // Truncated single-line preview of the result for the collapsed header
  const resultPreview = result
    ? result.replace(/\s+/g, ' ').trim().slice(0, 80) + (result.length > 80 ? '…' : '')
    : '';

  return (
    <Box flexDirection="column" marginY={0}>
      <Text>
        <Text color={theme.status.warning}>{expanded ? '▼' : '▶'} [tool_call] {name}</Text>
        {inlineArgs ? <Text color={theme.text.muted}> {inlineArgs}</Text> : null}
      </Text>
      {!expanded && resultPreview && (
        <Box marginLeft={2}>
          <Text color={theme.text.muted}>↳ {resultPreview}</Text>
        </Box>
      )}
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
