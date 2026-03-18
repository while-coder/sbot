import { isMCPToolResult, MCPContentType, MCPToolResult, parseJson } from "scorpio.ai";

export enum ProviderMessageType {
  TEXT = "text",
  TOOL = "tool",
}

export type ProviderTextMessage = {
  type: ProviderMessageType.TEXT;
  content: string;
};

export type ProviderToolMessage = {
  type: ProviderMessageType.TOOL;
  name: string;
  args: Record<string, any>;
  result?: boolean;
  status?: string;
  response?: string;
};

export type ProviderMessage = ProviderTextMessage | ProviderToolMessage;

export function parseMessages2Text(messages: ProviderMessage[]): string {
  const parts: string[] = [];
  for (const msg of messages) {
    if (msg.type === ProviderMessageType.TEXT) {
      parts.push(msg.content);
    } else {
      let block = `\`\`\`\nTool: ${msg.name}\nArgs:\n${JSON.stringify(msg.args, null, 2)}`;
      if (msg.result) {
        let escapedResponse = "";
        const parsed = parseJson<MCPToolResult>(msg.response!, undefined);
        if (isMCPToolResult(parsed)) {
          const contentParts: string[] = [];
          for (const c of parsed.content) {
            if (c.type === MCPContentType.Text) {
              contentParts.push(`------${c.type}------\n${c.text}`);
            } else if (c.type === MCPContentType.Image) {
              contentParts.push(`------${c.type}------\n[image:${c.mimeType}]`);
            } else if (c.type === MCPContentType.Audio) {
              contentParts.push(`------${c.type}------\n[audio:${c.mimeType}]`);
            } else {
              contentParts.push(`------${c.type}------\n${JSON.stringify(c)}`);
            }
          }
          escapedResponse = contentParts.join("\n");
        } else {
          escapedResponse = String(parsed);
        }
        escapedResponse = escapedResponse.replace(/`/g, "\\`");
        block += `\nResult:\n${escapedResponse}`;
      } else {
        block += `\nRunning...`;
      }
      block += `\n\`\`\`\n---`;
      parts.push(block);
    }
  }
  return parts.join("\n\n");
}
