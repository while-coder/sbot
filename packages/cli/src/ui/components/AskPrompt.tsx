import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Box, Text } from 'ink';
import { theme } from '../colors.js';
import { useKeypress, type Key } from '../hooks/useKeypress.js';
import type { PendingAsk, AskQuestionSpec } from '../types.js';

interface AskPromptProps {
  pending: PendingAsk;
  onResolve: (answers: Record<string, string | string[]>) => void;
}

const CUSTOM_LABEL = '其他 (自定义)';

export const AskPrompt: React.FC<AskPromptProps> = ({ pending, onResolve }) => {
  const { questions } = pending;
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});

  // Per-question state
  const [selectedOption, setSelectedOption] = useState(0);
  const [checkedOptions, setCheckedOptions] = useState<Set<number>>(new Set());
  const [inputText, setInputText] = useState('');
  const [customText, setCustomText] = useState('');
  const [editingCustom, setEditingCustom] = useState(false);

  const inputRef = useRef('');
  useEffect(() => { inputRef.current = inputText; }, [inputText]);

  const question = questions[questionIndex];
  const isLast = questionIndex === questions.length - 1;

  const advanceOrSubmit = useCallback(
    (answer: string | string[]) => {
      const key = String(questionIndex);
      const newAnswers = { ...answers, [key]: answer };
      setAnswers(newAnswers);

      if (isLast) {
        onResolve(newAnswers);
      } else {
        setQuestionIndex((i) => i + 1);
        setSelectedOption(0);
        setCheckedOptions(new Set());
        setInputText('');
        setCustomText('');
        setEditingCustom(false);
      }
    },
    [questionIndex, answers, isLast, onResolve],
  );

  const handleKeypress = useCallback(
    (key: Key) => {
      if (!question) return;

      if (question.type === 'radio') {
        const opts = question.options;
        const total = opts.length + 1; // +1 for custom
        const customIdx = opts.length;
        if (editingCustom) {
          if (key.name === 'return') {
            advanceOrSubmit(customText);
          } else if (key.name === 'escape') {
            setEditingCustom(false);
          } else if (key.name === 'backspace') {
            setCustomText((prev) => prev.slice(0, -1));
          } else if (key.sequence && !key.ctrl && !key.meta && key.name !== 'tab') {
            setCustomText((prev) => prev + key.sequence);
          }
        } else {
          if (key.name === 'up') {
            setSelectedOption((i) => (i > 0 ? i - 1 : total - 1));
          } else if (key.name === 'down') {
            setSelectedOption((i) => (i < total - 1 ? i + 1 : 0));
          } else if (key.name === 'return') {
            if (selectedOption === customIdx) {
              setEditingCustom(true);
            } else {
              advanceOrSubmit(opts[selectedOption]);
            }
          }
        }
      } else if (question.type === 'checkbox') {
        const opts = question.options;
        const total = opts.length + 1;
        const customIdx = opts.length;
        if (editingCustom) {
          if (key.name === 'return') {
            const selected = opts.filter((_, i) => checkedOptions.has(i));
            if (customText) selected.push(customText);
            advanceOrSubmit(selected);
          } else if (key.name === 'escape') {
            setEditingCustom(false);
          } else if (key.name === 'backspace') {
            setCustomText((prev) => prev.slice(0, -1));
          } else if (key.sequence && !key.ctrl && !key.meta && key.name !== 'tab') {
            setCustomText((prev) => prev + key.sequence);
          }
        } else {
          if (key.name === 'up') {
            setSelectedOption((i) => (i > 0 ? i - 1 : total - 1));
          } else if (key.name === 'down') {
            setSelectedOption((i) => (i < total - 1 ? i + 1 : 0));
          } else if (key.sequence === ' ') {
            if (selectedOption === customIdx) {
              setEditingCustom(true);
            } else {
              setCheckedOptions((prev) => {
                const next = new Set(prev);
                if (next.has(selectedOption)) next.delete(selectedOption);
                else next.add(selectedOption);
                return next;
              });
            }
          } else if (key.name === 'return') {
            const selected = opts.filter((_, i) => checkedOptions.has(i));
            advanceOrSubmit(selected);
          }
        }
      } else if (question.type === 'input') {
        if (key.name === 'return' && !key.shift) {
          advanceOrSubmit(inputRef.current);
        } else if (key.name === 'backspace') {
          setInputText((prev) => prev.slice(0, -1));
        } else if (key.name === 'escape') {
          setInputText('');
        } else if (key.sequence && !key.ctrl && !key.meta && key.name !== 'tab') {
          setInputText((prev) => prev + key.sequence);
        }
      }
    },
    [question, selectedOption, checkedOptions, advanceOrSubmit, editingCustom, customText],
  );

  useKeypress(handleKeypress, { isActive: true });

  if (!question) return null;

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={theme.status.info} paddingX={1}>
      {pending.title && (
        <Text bold color={theme.status.info}>{pending.title}</Text>
      )}
      <Text color={theme.text.secondary}>
        Question {questionIndex + 1}/{questions.length}
      </Text>
      <Text bold color={theme.text.primary}>{question.label}</Text>

      {question.type === 'radio' && (
        <RadioQuestion options={question.options} selectedIndex={selectedOption}
          editingCustom={editingCustom} customText={customText} />
      )}

      {question.type === 'checkbox' && (
        <CheckboxQuestion
          options={question.options}
          selectedIndex={selectedOption}
          checkedIndices={checkedOptions}
          editingCustom={editingCustom} customText={customText}
        />
      )}

      {question.type === 'input' && (
        <InputQuestion text={inputText} placeholder={question.placeholder} />
      )}

      <Box marginTop={1}>
        <Text color={theme.text.muted}>
          {question.type === 'radio' && (editingCustom ? 'Enter confirm  Esc back' : '↑↓ select  Enter confirm')}
          {question.type === 'checkbox' && (editingCustom ? 'Enter confirm  Esc back' : '↑↓ move  Space toggle  Enter confirm')}
          {question.type === 'input' && 'Enter submit  Esc clear'}
        </Text>
      </Box>
    </Box>
  );
};

// ── Sub-components ──

const RadioQuestion: React.FC<{
  options: string[]; selectedIndex: number;
  editingCustom: boolean; customText: string;
}> = ({ options, selectedIndex, editingCustom, customText }) => {
  const customIdx = options.length;
  return (
    <Box flexDirection="column" marginTop={1}>
      {options.map((opt, i) => (
        <Text key={i} color={i === selectedIndex && !editingCustom ? theme.text.accent : theme.text.primary}>
          {i === selectedIndex && !editingCustom ? '◉ ' : '○ '}{opt}
        </Text>
      ))}
      <Text color={selectedIndex === customIdx || editingCustom ? theme.text.accent : theme.text.primary}>
        {selectedIndex === customIdx || editingCustom ? '◉ ' : '○ '}{CUSTOM_LABEL}
      </Text>
      {editingCustom && (
        <Box borderStyle="single" borderColor={theme.text.accent} paddingX={1}>
          {customText.length === 0 ? (
            <Text color={theme.text.muted}>输入自定义选项...</Text>
          ) : (
            <Text color={theme.text.primary}>{customText}<Text color={theme.text.accent}>▊</Text></Text>
          )}
        </Box>
      )}
    </Box>
  );
};

const CheckboxQuestion: React.FC<{
  options: string[]; selectedIndex: number; checkedIndices: Set<number>;
  editingCustom: boolean; customText: string;
}> = ({ options, selectedIndex, checkedIndices, editingCustom, customText }) => {
  const customIdx = options.length;
  return (
    <Box flexDirection="column" marginTop={1}>
      {options.map((opt, i) => {
        const checked = checkedIndices.has(i);
        const focused = i === selectedIndex && !editingCustom;
        return (
          <Text key={i} color={focused ? theme.text.accent : theme.text.primary}>
            {checked ? '☑ ' : '☐ '}{opt}
          </Text>
        );
      })}
      <Text color={selectedIndex === customIdx || editingCustom ? theme.text.accent : theme.text.primary}>
        {'☐ '}{CUSTOM_LABEL}
      </Text>
      {editingCustom && (
        <Box borderStyle="single" borderColor={theme.text.accent} paddingX={1}>
          {customText.length === 0 ? (
            <Text color={theme.text.muted}>输入自定义选项...</Text>
          ) : (
            <Text color={theme.text.primary}>{customText}<Text color={theme.text.accent}>▊</Text></Text>
          )}
        </Box>
      )}
    </Box>
  );
};

const InputQuestion: React.FC<{ text: string; placeholder?: string }> = ({
  text,
  placeholder,
}) => (
  <Box marginTop={1} borderStyle="single" borderColor={theme.text.muted} paddingX={1}>
    {text.length === 0 ? (
      <Text color={theme.text.muted}>{placeholder || 'Type your answer...'}</Text>
    ) : (
      <Text color={theme.text.primary}>
        {text}
        <Text color={theme.text.accent}>▊</Text>
      </Text>
    )}
  </Box>
);
