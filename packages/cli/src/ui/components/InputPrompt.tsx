import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Text, Box } from 'ink';
import { theme } from '../colors.js';
import { useKeypress, type Key } from '../hooks/useKeypress.js';
import {
  validateFilePath,
  isImageFile,
  type PendingAttachment,
} from '../utils/fileAttachment.js';
import { readClipboard } from '../utils/clipboard.js';
import { basename } from 'node:path';
import type { CommandRegistry } from '../../commands/registry.js';
import type { CommandMatch } from '../../commands/types.js';
import { CommandSuggestions } from './CommandSuggestions.js';

export type { PendingAttachment } from '../utils/fileAttachment.js';

interface InputPromptProps {
  isActive: boolean;
  onSubmit: (text: string, attachments: PendingAttachment[]) => void;
  onCancel: () => void;
  commandRegistry?: CommandRegistry;
  placeholder?: string;
}

export const InputPrompt: React.FC<InputPromptProps> = ({
  isActive,
  onSubmit,
  onCancel,
  commandRegistry,
  placeholder = 'Type your message... (Shift+Enter for newline, / for commands)',
}) => {
  const [input, setInput] = useState('');
  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [attachMode, setAttachMode] = useState(false);
  const [attachError, setAttachError] = useState('');

  const [commandMatches, setCommandMatches] = useState<CommandMatch[]>([]);
  const [suggestionIndex, setSuggestionIndex] = useState(0);

  const inputRef = useRef('');
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const attachmentsRef = useRef<PendingAttachment[]>([]);
  const attachModeRef = useRef(false);
  const isPastingRef = useRef(false);
  const commandMatchesRef = useRef<CommandMatch[]>([]);
  const suggestionIndexRef = useRef(0);

  useEffect(() => { inputRef.current = input; }, [input]);
  useEffect(() => { historyRef.current = inputHistory; }, [inputHistory]);
  useEffect(() => { historyIndexRef.current = historyIndex; }, [historyIndex]);
  useEffect(() => { attachmentsRef.current = attachments; }, [attachments]);
  useEffect(() => { attachModeRef.current = attachMode; }, [attachMode]);
  useEffect(() => { commandMatchesRef.current = commandMatches; }, [commandMatches]);
  useEffect(() => { suggestionIndexRef.current = suggestionIndex; }, [suggestionIndex]);

  useEffect(() => {
    if (commandRegistry && input.startsWith('/') && !attachMode) {
      const matches = commandRegistry.match(input);
      setCommandMatches(matches);
      setSuggestionIndex(0);
    } else {
      setCommandMatches([]);
      setSuggestionIndex(0);
    }
  }, [input, commandRegistry, attachMode]);

  const isCommandMode = input.startsWith('/') && commandMatches.length > 0 && !attachMode;

  const handleKeypress = useCallback(
    (key: Key) => {
      if (attachModeRef.current) {
        if (key.name === 'escape') {
          setAttachMode(false);
          setAttachError('');
          setInput('');
          return;
        }
        if (key.name === 'return') {
          const raw = inputRef.current.trim();
          if (!raw) return;
          const resolved = validateFilePath(raw);
          if (!resolved) {
            setAttachError(`File not found or too large: ${raw}`);
            return;
          }
          const att: PendingAttachment = {
            filePath: resolved,
            name: basename(resolved),
            isImage: isImageFile(resolved),
          };
          setAttachments(prev => [...prev, att]);
          setAttachMode(false);
          setAttachError('');
          setInput('');
          return;
        }
        if (key.name === 'backspace') {
          setInput(prev => prev.slice(0, -1));
          setAttachError('');
          return;
        }
        if (key.sequence && !key.ctrl && !key.meta && key.name !== 'tab') {
          setInput(prev => prev + key.sequence);
          setAttachError('');
        }
        return;
      }

      if (inputRef.current.startsWith('/') && commandMatchesRef.current.length > 0) {
        if (key.name === 'up') {
          setSuggestionIndex(i => (i > 0 ? i - 1 : Math.min(commandMatchesRef.current.length, 5) - 1));
          return;
        }
        if (key.name === 'down') {
          setSuggestionIndex(i => (i < Math.min(commandMatchesRef.current.length, 5) - 1 ? i + 1 : 0));
          return;
        }
        if (key.name === 'tab') {
          const match = commandMatchesRef.current[suggestionIndexRef.current];
          if (match) {
            setInput('/' + match.command.name + ' ');
          }
          return;
        }
      }

      if (key.ctrl && key.name === 'c') {
        onCancel();
        return;
      }

      if (key.ctrl && key.name === 'v') {
        if (isPastingRef.current) return;
        isPastingRef.current = true;
        readClipboard()
          .then(result => {
            if (result.type === 'image') {
              setAttachments(prev => [...prev, {
                filePath: result.filePath,
                name: basename(result.filePath),
                isImage: true,
              }]);
            } else if (result.type === 'files') {
              const newAtts = result.filePaths
                .map(fp => validateFilePath(fp))
                .filter((fp): fp is string => fp !== null)
                .map(fp => ({
                  filePath: fp,
                  name: basename(fp),
                  isImage: isImageFile(fp),
                }));
              if (newAtts.length > 0) {
                setAttachments(prev => [...prev, ...newAtts]);
              }
            }
          })
          .finally(() => { isPastingRef.current = false; });
        return;
      }

      if (key.ctrl && key.name === 'a') {
        setAttachMode(true);
        setAttachError('');
        setInput('');
        return;
      }

      if (key.ctrl && key.name === 'd') {
        setAttachments(prev => prev.slice(0, -1));
        return;
      }

      if (key.name === 'return' && !key.shift) {
        const trimmed = inputRef.current.trim();
        const atts = [...attachmentsRef.current];

        if (trimmed && atts.length === 0) {
          const resolved = validateFilePath(trimmed);
          if (resolved) {
            const att: PendingAttachment = {
              filePath: resolved,
              name: basename(resolved),
              isImage: isImageFile(resolved),
            };
            setInputHistory(prev => [...prev, trimmed]);
            setHistoryIndex(-1);
            onSubmit('', [att]);
            setInput('');
            setAttachments([]);
            return;
          }
        }

        if (trimmed || atts.length > 0) {
          if (trimmed) {
            setInputHistory(prev => [...prev, trimmed]);
          }
          setHistoryIndex(-1);
          onSubmit(trimmed, atts);
          setInput('');
          setAttachments([]);
        }
        return;
      }

      if (key.name === 'return' && key.shift) {
        setInput(prev => prev + '\n');
        return;
      }

      if (key.name === 'backspace') {
        setInput(prev => prev.slice(0, -1));
        return;
      }

      if (key.name === 'escape') {
        setInput('');
        setHistoryIndex(-1);
        return;
      }

      if (!inputRef.current.startsWith('/')) {
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
      }

      if (key.ctrl && key.name === 'u') {
        setInput('');
        setHistoryIndex(-1);
        return;
      }

      if (key.sequence && !key.ctrl && !key.meta && key.name !== 'tab') {
        setInput(prev => prev + key.sequence);
      }
    },
    [onSubmit, onCancel],
  );

  useKeypress(handleKeypress, { isActive });

  return (
    <Box flexDirection="column" marginTop={1}>
      {isCommandMode && (
        <CommandSuggestions matches={commandMatches} selectedIndex={suggestionIndex} />
      )}
      <Box borderStyle="single" borderColor={theme.text.muted} paddingX={1} flexDirection="column">
        {attachments.length > 0 && (
          <Box flexDirection="column">
            {attachments.map((att, i) => (
              <Text key={i} color={theme.status.info}>
                {att.isImage ? '[img]' : '[file]'} {att.name}
              </Text>
            ))}
          </Box>
        )}
        {attachMode ? (
          <Box flexDirection="column">
            <Box>
              <Text color={theme.status.warning}>Attach: </Text>
              <Text color={theme.text.primary}>
                {input || <Text color={theme.text.muted}>paste or type file path</Text>}
                {isActive && <Text color={theme.text.accent}>▊</Text>}
              </Text>
            </Box>
            {attachError && <Text color={theme.status.error}>{attachError}</Text>}
          </Box>
        ) : input.length === 0 && attachments.length === 0 ? (
          <Text color={theme.text.muted}>{placeholder}</Text>
        ) : (
          <Text color={input.startsWith('/') ? theme.status.info : theme.text.primary}>
            {input}
            {isActive && <Text color={theme.text.accent}>▊</Text>}
          </Text>
        )}
      </Box>
    </Box>
  );
};
