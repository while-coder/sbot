export const Colors = {
  foreground: '#e0e0e0',
  accentBlue: '#5b9bd5',
  accentCyan: '#4ec9b0',
  accentGreen: '#6a9955',
  accentYellow: '#dcdcaa',
  accentRed: '#f44747',
  accentPurple: '#c586c0',
  gray: '#808080',
  dimGray: '#505050',
} as const;

export const theme = {
  text: {
    primary: Colors.foreground,
    secondary: Colors.gray,
    accent: Colors.accentBlue,
    muted: Colors.dimGray,
  },
  status: {
    success: Colors.accentGreen,
    error: Colors.accentRed,
    warning: Colors.accentYellow,
    info: Colors.accentCyan,
  },
  prompt: {
    userPrefix: Colors.accentBlue,
    assistantPrefix: Colors.accentCyan,
  },
} as const;
