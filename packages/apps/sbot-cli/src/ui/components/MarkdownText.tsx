import React, { useMemo } from 'react';
import { Text } from 'ink';
import { Marked, type MarkedExtension } from 'marked';
import { markedTerminal } from 'marked-terminal';

// @types/marked-terminal is outdated; the runtime return is a valid MarkedExtension
const md = new Marked(markedTerminal() as unknown as MarkedExtension);

export interface MarkdownTextProps {
  children: string;
}

export const MarkdownText: React.FC<MarkdownTextProps> = ({ children }) => {
  const rendered = useMemo(() => {
    try {
      const result = md.parse(children) as string;
      // marked-terminal adds trailing newlines; strip them
      return result.replace(/\n+$/, '');
    } catch {
      return children;
    }
  }, [children]);

  return <Text>{rendered}</Text>;
};
