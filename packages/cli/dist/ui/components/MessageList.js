import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from 'ink';
import { theme } from '../colors.js';
import { MessageItem } from './MessageItem.js';
export const MessageList = ({ history, streamingContent, isInputActive, }) => {
    return (_jsxs(Box, { flexDirection: "column", flexGrow: 1, overflow: "hidden", children: [history.length === 0 && !streamingContent && (_jsx(Box, { paddingX: 2, paddingY: 1, children: _jsx(Text, { color: theme.text.muted, children: "No messages yet. Start typing below." }) })), _jsxs(Box, { flexDirection: "column", paddingX: 2, children: [history.map((item) => (_jsx(MessageItem, { item: item, isInputActive: isInputActive }, item.id))), streamingContent && (_jsxs(Box, { flexDirection: "column", marginBottom: 1, children: [_jsx(Text, { bold: true, color: theme.prompt.assistantPrefix, children: "Assistant" }), _jsxs(Text, { color: theme.text.primary, children: [streamingContent, _jsx(Text, { color: theme.text.accent, children: "\u258A" })] })] }))] })] }));
};
//# sourceMappingURL=MessageList.js.map