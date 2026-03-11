import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useCallback, useRef, useEffect } from 'react';
import { Text, Box } from 'ink';
import { theme } from '../colors.js';
import { useKeypress } from '../hooks/useKeypress.js';
export const InputPrompt = ({ isActive, onSubmit, onCancel, placeholder = 'Type your message... (Shift+Enter for newline)', }) => {
    const [input, setInput] = useState('');
    const [inputHistory, setInputHistory] = useState([]);
    const [historyIndex, setHistoryIndex] = useState(-1);
    // Refs for stable callback access (avoids re-subscribing on every keystroke)
    const inputRef = useRef('');
    const historyRef = useRef([]);
    const historyIndexRef = useRef(-1);
    useEffect(() => { inputRef.current = input; }, [input]);
    useEffect(() => { historyRef.current = inputHistory; }, [inputHistory]);
    useEffect(() => { historyIndexRef.current = historyIndex; }, [historyIndex]);
    const handleKeypress = useCallback((key) => {
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
                }
                else {
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
    }, [onSubmit, onCancel]);
    useKeypress(handleKeypress, { isActive });
    return (_jsx(Box, { flexDirection: "column", marginTop: 1, borderStyle: "single", borderColor: theme.text.muted, paddingX: 1, children: input.length === 0 ? (_jsx(Text, { color: theme.text.muted, children: placeholder })) : (_jsxs(Text, { color: theme.text.primary, children: [input, isActive && _jsx(Text, { color: theme.text.accent, children: "\u258A" })] })) }));
};
//# sourceMappingURL=InputPrompt.js.map