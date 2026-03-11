import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from 'ink';
import { theme } from '../colors.js';
import { ToolCallItem } from './ToolCallItem.js';
export const MessageItem = ({ item, isInputActive }) => {
    switch (item.type) {
        case 'user':
            return (_jsxs(Box, { flexDirection: "column", marginBottom: 1, children: [_jsx(Text, { bold: true, color: theme.prompt.userPrefix, children: "You" }), _jsx(Text, { color: theme.text.primary, children: item.content })] }));
        case 'assistant':
            return (_jsxs(Box, { flexDirection: "column", marginBottom: 1, children: [_jsx(Text, { bold: true, color: theme.prompt.assistantPrefix, children: "Assistant" }), _jsx(Text, { color: theme.text.primary, children: item.content })] }));
        case 'tool_call':
            return (_jsx(Box, { marginBottom: 1, children: _jsx(ToolCallItem, { name: item.name, args: item.args, isInputActive: isInputActive }) }));
        case 'error':
            return (_jsx(Box, { marginBottom: 1, children: _jsxs(Text, { color: theme.status.error, children: ["Error: ", item.message] }) }));
        default:
            return null;
    }
};
//# sourceMappingURL=MessageItem.js.map