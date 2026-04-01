import { ChatMessage, MessageRole, isMCPToolResult, MCPContentType, MCPToolResult, parseJson } from "scorpio.ai";

function contentToText(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const c of content) {
    if (c.type === 'text' && c.text) {
      parts.push(c.text);
    } else if (c.type === 'image' || c.type === 'image_url') {
      parts.push(`[image:${c.mimeType ?? 'unknown'}]`);
    } else if (c.type === 'audio') {
      parts.push(`[audio:${c.mimeType ?? 'unknown'}]`);
    }
  }
  return parts.join('\n');
}

function formatToolResult(response: string): string {
  const parsed = parseJson<MCPToolResult>(response, undefined);
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
    return contentParts.join("\n").replace(/`/g, "\\`");
  }
  const text = parsed !== undefined ? String(parsed) : response;
  return text.replace(/`/g, "\\`");
}

export function parseMessages2Text(messages: ChatMessage[]): string {
  // Build a map of tool_call_id -> tool result message for quick lookup
  const toolResults = new Map<string, ChatMessage>();
  for (const msg of messages) {
    if (msg.role === MessageRole.Tool && msg.tool_call_id) {
      toolResults.set(msg.tool_call_id, msg);
    }
  }

  const parts: string[] = [];
  for (const msg of messages) {
    if (msg.role === MessageRole.Human) continue;
    if (msg.role === MessageRole.Tool) continue; // rendered inline with tool_calls

    if (msg.isCommand || msg.role === MessageRole.AI) {
      const text = contentToText(msg.content);
      if (text) parts.push(text);

      if (msg.tool_calls?.length) {
        for (const t of msg.tool_calls) {
          let block = `\`\`\`\nTool: ${t.name}\nArgs:\n${JSON.stringify(t.args, null, 2)}`;
          const result = t.id ? toolResults.get(t.id) : undefined;
          if (result) {
            const response = contentToText(result.content);
            block += `\nResult:\n${formatToolResult(response)}`;
          } else {
            block += `\nRunning...`;
          }
          block += `\n\`\`\`\n---`;
          parts.push(block);
        }
      }
    }
  }
  return parts.join("\n\n");
}
