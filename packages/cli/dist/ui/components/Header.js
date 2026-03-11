import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from 'ink';
import { theme } from '../colors.js';
export const Header = ({ agentName, saverName }) => (_jsxs(Box, { borderStyle: "single", borderColor: theme.text.muted, paddingX: 1, children: [_jsx(Text, { bold: true, color: theme.text.accent, children: "sbot-cli" }), _jsx(Text, { color: theme.text.muted, children: "  \u2502  " }), _jsx(Text, { color: theme.text.muted, children: "  Agent: " }), _jsx(Text, { color: theme.text.primary, children: agentName }), _jsx(Text, { color: theme.text.muted, children: "  Saver: " }), _jsx(Text, { color: theme.text.primary, children: saverName })] }));
//# sourceMappingURL=Header.js.map