# 项目结构说明

## 目录结构

```
src/
├── Agent/                    # Agent 核心服务
│   └── AgentService.ts      # LangGraph 状态图 Agent
│
├── Config.ts                # 配置管理
│
├── LoggerService.ts         # 日志服务
│
├── Skills/                  # Skills 系统（非工具部分）
│   ├── index.ts            # 统一导出
│   ├── types.ts            # 类型定义
│   ├── parser.ts           # Skill 解析器
│   └── loader.ts           # Skill 加载器
│
├── Tools/                   # 🆕 所有工具集中管理
│   ├── index.ts            # 统一导出所有工具
│   │
│   ├── mcp/                # MCP 标准类型定义
│   │   ├── types.ts        # MCPToolResult, MCPContent 等
│   │   └── index.ts        # 导出
│   │
│   ├── FileSystem/         # 文件系统工具
│   │   ├── index.ts        # 所有文件系统工具
│   │   └── config.ts       # 配置类型
│   │
│   └── Skills/             # Skills 相关工具
│       └── index.ts        # read_skill_file, execute_skill_script 等
│
├── UserService/            # 用户服务基类
│
└── Lark/                   # 飞书集成
    ├── LarkService.ts
    ├── LarkUserService.ts
    └── LarkChatProvider.ts
```

## 模块说明

### 🔧 Tools 目录（核心改进）

所有工具现在集中在 `Tools` 目录下，按功能分类：

#### MCP 类型系统 (`Tools/mcp/`)

标准的 MCP (Model Context Protocol) 类型定义：

```typescript
// 从 Tools/mcp 导入
import {
    MCPToolResult,
    MCPContent,
    createTextContent,
    createSuccessResult,
    createErrorResult
} from '../Tools/mcp';
```

**核心类型**：
- `MCPTextContent` - 文本内容块
- `MCPImageContent` - 图片内容块
- `MCPAudioContent` - 音频内容块
- `MCPToolResult` - 工具返回结果

**辅助函数**：
- `createTextContent(text)` - 创建文本内容
- `createSuccessResult(...contents)` - 创建成功结果
- `createErrorResult(message)` - 创建错误结果

#### 文件系统工具 (`Tools/FileSystem/`)

提供完整的文件操作能力：

```typescript
import { createFileSystemTools } from '../Tools';
```

**包含的工具**：
- `read_file` - 读取文件
- `write_file` - 写入文件
- `append_file` - 追加内容
- `replace_in_file` - 替换内容
- `search_in_file` - 搜索文件内容
- `search_files` - 搜索文件
- `grep_files` - 内容搜索
- `list_directory` - 列出目录
- `create_directory` - 创建目录
- `delete_directory` - 删除目录
- `delete_file` - 删除文件
- `move_file` - 移动/重命名
- `copy_file` - 复制文件
- `file_exists` - 检查文件存在
- `execute_command` - 执行命令
- `execute_script` - 执行脚本

#### Skills 工具 (`Tools/Skills/`)

Skills 系统相关的工具：

```typescript
import { createSkillTools } from '../Tools';
```

**包含的工具**：
- `read_skill_file` - 读取 skill 文件
- `execute_skill_script` - 执行 skill 脚本
- `list_skill_files` - 列出 skill 目录结构

### 📦 Agent 服务 (`Agent/`)

使用 LangGraph 构建的 Agent 服务：

```typescript
import { AgentService } from '../Agent/AgentService';
```

**核心功能**：
- 流式对话处理
- 工具调用管理
- 历史记录管理
- MCP 格式自动处理

### 🎯 Skills 系统 (`Skills/`)

Skill 管理和加载系统（不包括工具，工具在 `Tools/Skills`）：

```typescript
import { loadSkills, Skill } from '../Skills';
```

**功能**：
- Skill 解析和加载
- Skill 元数据管理
- Skill 文件路径管理

## 使用示例

### 创建自定义工具

```typescript
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { createTextContent, createSuccessResult, createErrorResult, MCPToolResult } from '../Tools/mcp';

export function createMyTool() {
    return new DynamicStructuredTool({
        name: 'my_tool',
        description: '我的工具',
        schema: z.object({
            input: z.string()
        }),
        func: async ({ input }): Promise<MCPToolResult> => {
            try {
                const result = processInput(input);
                return createSuccessResult(
                    createTextContent(`处理成功`),
                    createTextContent(result)
                );
            } catch (error: any) {
                return createErrorResult(error.message);
            }
        }
    });
}
```

### 在 AgentService 中使用工具

```typescript
import { AgentService } from './Agent/AgentService';

const agent = new AgentService('user-id');

await agent.stream(
    '你好',
    async (message) => {
        // 处理消息
        console.log(message);
    }
);
```

## 迁移指南

### 从旧结构迁移

**旧导入**：
```typescript
import { createFileSystemTools } from '../FileSystemTools';
import { createSkillTools } from '../Skills';
import { MCPToolResult } from '../FileSystemTools/mcpTypes';
```

**新导入**：
```typescript
import {
    createFileSystemTools,
    createSkillTools,
    MCPToolResult
} from '../Tools';
```

### 向后兼容

为了保持向后兼容，`Skills/index.ts` 重导出了工具函数：

```typescript
// 仍然可以这样导入（但推荐使用新路径）
import { createSkillTools } from '../Skills';
```

## 优势

### ✅ 集中管理
所有工具集中在 `Tools` 目录，便于查找和维护。

### ✅ 模块化
按功能分类（FileSystem、Skills、MCP），清晰的职责划分。

### ✅ 统一导出
通过 `Tools/index.ts` 统一导出，简化导入语句。

### ✅ 标准化
所有工具遵循 MCP 标准返回格式。

### ✅ 类型安全
完整的 TypeScript 类型支持，编译时检查。

## 相关文档

- [MCP 工具格式指南](mcp-tool-format-guide.md)
- [Skills 系统文档](../src/Skills/README.md)（如果存在）
