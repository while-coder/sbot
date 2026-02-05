# MCP 工具返回格式指南

## 标准 MCP 返回格式

所有 MCP 工具应该返回以下标准格式：

```typescript
{
  content: [
    { type: "text", text: "File saved." },
    { type: "text", text: "Path: /tmp/output.txt" }
  ],
  isError?: boolean  // 可选，表示是否为错误
}
```

## 支持的内容类型

### 1. 文本内容 (TextContent)

```typescript
{
  type: "text",
  text: "这是文本内容"
}
```

### 2. 图片内容 (ImageContent)

```typescript
{
  type: "image",
  data: "base64编码的图片数据",
  mimeType: "image/png"
}
```

### 3. 音频内容 (AudioContent)

```typescript
{
  type: "audio",
  data: "base64编码的音频数据",
  mimeType: "audio/mpeg"
}
```

## 辅助函数

使用 `src/FileSystemTools/mcpTypes.ts` 中的辅助函数：

```typescript
import {
    createTextContent,
    createImageContent,
    createErrorResult,
    createSuccessResult,
    MCPToolResult
} from './mcpTypes';
```

### 创建成功结果

```typescript
// 单个文本内容
return createSuccessResult(
    createTextContent("操作成功")
);

// 多个内容块
return createSuccessResult(
    createTextContent("文件保存成功"),
    createTextContent(`路径: ${filePath}`),
    createTextContent(fileContent)
);
```

### 创建错误结果

```typescript
return createErrorResult("文件不存在");
```

### 创建图片内容

```typescript
return createSuccessResult(
    createTextContent("图片生成成功"),
    createImageContent(base64Data, "image/png")
);
```

## 完整示例

### 示例 1: 简单的读取文件工具

```typescript
export function createReadFileTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'read_file',
        description: '读取文件内容',
        schema: z.object({
            filePath: z.string()
        }),
        func: async ({ filePath }): Promise<MCPToolResult> => {
            try {
                // 验证路径
                if (!fs.existsSync(filePath)) {
                    return createErrorResult(`文件不存在: ${filePath}`);
                }

                // 读取文件
                const content = fs.readFileSync(filePath, 'utf-8');
                const stat = fs.statSync(filePath);

                // 返回 MCP 格式
                return createSuccessResult(
                    createTextContent(`文件读取成功: ${filePath}`),
                    createTextContent(`大小: ${stat.size} 字节`),
                    createTextContent(content)
                );

            } catch (error: any) {
                return createErrorResult(error.message);
            }
        }
    });
}
```

### 示例 2: 返回图片的工具

```typescript
export function createGenerateImageTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'generate_image',
        description: '生成图片',
        schema: z.object({
            prompt: z.string()
        }),
        func: async ({ prompt }): Promise<MCPToolResult> => {
            try {
                // 生成图片（示例）
                const imageData = generateImage(prompt);
                const base64Data = Buffer.from(imageData).toString('base64');

                return createSuccessResult(
                    createTextContent(`图片生成成功: ${prompt}`),
                    createImageContent(base64Data, "image/png")
                );

            } catch (error: any) {
                return createErrorResult(error.message);
            }
        }
    });
}
```

### 示例 3: 返回多种信息的工具

```typescript
export function createAnalyzeTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'analyze_code',
        description: '分析代码',
        schema: z.object({
            code: z.string()
        }),
        func: async ({ code }): Promise<MCPToolResult> => {
            try {
                const analysis = analyzeCode(code);

                return createSuccessResult(
                    createTextContent("代码分析完成"),
                    createTextContent(`行数: ${analysis.lines}`),
                    createTextContent(`复杂度: ${analysis.complexity}`),
                    createTextContent(`建议:\n${analysis.suggestions.join('\n')}`)
                );

            } catch (error: any) {
                return createErrorResult(error.message);
            }
        }
    });
}
```

## 向后兼容

AgentService 会自动检测返回格式：

```typescript
// 新格式 - 保持不变
{ content: [{ type: "text", text: "..." }] }

// 旧格式 - 转换为字符串
"simple string"
{ success: true, data: "..." }
```

在 [AgentService.ts:372-392](../src/Agent/AgentService.ts#L372-L392) 中的处理逻辑：

```typescript
// 处理 MCP 标准格式
if (result && typeof result === "object" && "content" in result) {
    // 已经是 MCP 标准格式
    content = JSON.stringify(result);
} else {
    // 旧格式，转换为字符串
    content = typeof result === "string" ? result : JSON.stringify(result);
}
```

## 迁移清单

✅ **已完成**:
- [x] 创建 MCP 类型定义 ([src/FileSystemTools/mcpTypes.ts](../src/FileSystemTools/mcpTypes.ts))
- [x] 更新 Skills 工具 ([src/Skills/tools.ts](../src/Skills/tools.ts))
- [x] 更新 AgentService 处理逻辑 ([src/Agent/AgentService.ts](../src/Agent/AgentService.ts))
- [x] 示例工具更新 (read_file)

🔲 **待完成**:
- [ ] 更新所有 FileSystemTools (86个返回点)
- [ ] 更新 MCP 服务器工具
- [ ] 添加单元测试

## 批量转换脚本

使用提供的脚本进行批量转换：

```bash
node scripts/convert-to-mcp-format.js
```

**注意**: 脚本会自动备份原文件到 `.backup` 扩展名。

## 类型定义位置

- **MCP 类型**: [src/FileSystemTools/mcpTypes.ts](../src/FileSystemTools/mcpTypes.ts)
- **辅助函数**:
  - `createTextContent(text: string)`
  - `createImageContent(data: string, mimeType?: string)`
  - `createSuccessResult(...contents: MCPContent[])`
  - `createErrorResult(errorMessage: string)`

## 参考资料

- [MCP 规范](https://github.com/modelcontextprotocol/modelcontextprotocol)
- [@modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk)
