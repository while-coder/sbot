export interface CommandTextContent {
    type: 'text';
    text: string;
}

export interface CommandToolResult {
    content: CommandTextContent[];
    isError?: boolean;
}

export function createTextContent(text: string): CommandTextContent {
    return { type: 'text', text };
}

export function createErrorResult(message: string): CommandToolResult {
    return { content: [createTextContent(message)], isError: true };
}
