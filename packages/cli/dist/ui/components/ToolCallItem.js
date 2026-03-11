import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { useState, useCallback } from 'react';
import { Box, Text } from 'ink';
import { theme } from '../colors.js';
import { useKeypress } from '../hooks/useKeypress.js';
export const ToolCallItem = ({ name, args, isInputActive }) => {
    const [expanded, setExpanded] = useState(false);
    const handleKeypress = useCallback((key) => {
        if (key.name === 'tab') {
            setExpanded((e) => !e);
        }
    }, []);
    // Only handle Tab when input is active (idle state)
    useKeypress(handleKeypress, { isActive: isInputActive });
    const argsText = typeof args === 'string' ? args : JSON.stringify(args, null, 2);
    return (_jsxs(Box, { flexDirection: "column", marginY: 0, children: [_jsxs(Text, { color: theme.status.warning, children: [expanded ? '▼' : '▶', " [tool_call] ", name] }), expanded && (_jsx(Box, { marginLeft: 2, marginBottom: 1, children: _jsx(Text, { color: theme.text.muted, children: argsText }) }))] }));
};
//# sourceMappingURL=ToolCallItem.js.map