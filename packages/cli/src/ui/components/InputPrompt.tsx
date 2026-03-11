import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Text, Box } from 'ink';
import { theme } from '../colors.js';
import { useKeypress, type Key } from '../hooks/useKeypress.js';

interface InputPromptProps {
  isActive: boolean;
  onSubmit: (text: string) => void;
  onCancel: () => void;
  placeholder?: string;
}

export const InputPrompt: React.FC<InputPromptProps> = ({
  isActive,
  onSubmit,
  onCancel,
  placeholder = 'Type your message... (Shift+Enter for newline)',
}) => {
  const [input, setInput] = useState('');
  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Refs for stable callback access (avoids re-subscribing on every keystroke)
  const inputRef = useRef('');
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);

  useEffect(() => { inputRef.current = input; }, [input]);
  useEffect(() => { historyRef.current = inputHistory; }, [inputHistory]);
  useEffect(() => { historyIndexRef.current = historyIndex; }, [historyIndex]);

  const handleKeypress = useCallback(
    (key: Key) => {
      if (key.ctrl && key.name === 'c') {
        onCancel();
        return;
      }

      if (key.name === 'return' && !key.shift) {
        const trimmed = inputRef.current.trim();
        if (trimmed) {
          setInputHistory((prev) => [...prev, trimmed]);
          setHistoryIndex(-1);
          onSubmit(trimmed);
          setInput('');
        }
        return;
      }

      if (key.name === 'return' && key.shift) {
        setInput((prev) => prev + '\n');
        return;
      }

      if (key.name === 'backspace') {
        setInput((prev) => prev.slice(0, -1));
        return;
      }

      if (key.name === 'escape') {
        setInput('');
        setHistoryIndex(-1);
        return;
      }

      if (key.name === 'up') {
        const hist = historyRef.current;
        const idx = historyIndexRef.current;
        if (hist.length > 0) {
          const newIndex = idx === -1 ? hist.length - 1 : Math.max(0, idx - 1);
          setHistoryIndex(newIndex);
          setInput(hist[newIndex] ?? '');
        }
        return;
      }

      if (key.name === 'down') {
        const hist = historyRef.current;
        const idx = historyIndexRef.current;
        if (idx >= 0) {
          const newIndex = idx + 1;
          if (newIndex >= hist.length) {
            setHistoryIndex(-1);
            setInput('');
          } else {
            setHistoryIndex(newIndex);
            setInput(hist[newIndex] ?? '');
          }
        }
        return;
      }

      if (key.ctrl && key.name === 'u') {
        setInput('');
        setHistoryIndex(-1); // reset history navigation position
        return;
      }

      if (key.sequence && !key.ctrl && !key.meta && key.name !== 'tab') {
        setInput((prev) => prev + key.sequence);
      }
    },
    [onSubmit, onCancel],
  );

  useKeypress(handleKeypress, { isActive });

  return (
    <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor={theme.text.muted} paddingX={1}>
      {input.length === 0 ? (
        <Text color={theme.text.muted}>{placeholder}</Text>
      ) : (
        <Text color={theme.text.primary}>
          {input}
          {isActive && <Text color={theme.text.accent}>▊</Text>}
        </Text>
      )}
    </Box>
  );
};
