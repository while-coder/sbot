import { jsx as _jsx } from "react/jsx-runtime";
import { Box, Text } from 'ink';
import { theme } from '../colors.js';
import { StreamingState } from '../types.js';
export const Footer = ({ streamingState }) => (_jsx(Box, { borderStyle: "single", borderColor: theme.text.muted, paddingX: 1, children: streamingState === StreamingState.Responding ? (_jsx(Text, { color: theme.status.warning, children: "Ctrl+C cancel" })) : (_jsx(Text, { color: theme.text.muted, children: "Enter send  Shift+Enter newline  \u2191\u2193 history  Tab fold tool_call  Ctrl+L clear  Ctrl+C exit" })) }));
//# sourceMappingURL=Footer.js.map