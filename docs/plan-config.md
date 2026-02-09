# Plan 模式配置说明

sbot 支持三种 Agent 运行模式，可以通过 `~/.sbot/settings.json` 中的 `plan` 配置进行切换。

## 配置结构

```json
{
  "plan": {
    "mode": "single | supervisor | react",
    "maxIterations": 5,
    "agents": [
      {
        "id": "agent-1",
        "type": "coder",
        "skillName": "python-developer",
        "tools": ["read_file", "write_file", "execute_command"],
        "systemPrompt": "你是一个 Python 开发专家"
      }
    ]
  }
}
```

### 配置字段说明

- **mode**: 运行模式
  - `"single"` - 单 Agent 模式（默认）
  - `"supervisor"` - Supervisor 模式（预先规划）
  - `"react"` - ReAct 模式（迭代决策）

- **maxIterations**: ReAct 模式的最大迭代次数（默认：5）
  - 仅在 `mode: "react"` 时生效
  - 防止无限循环

- **agents**: Agent 配置列表
  - 在 `supervisor` 和 `react` 模式下必须提供
  - 每个 Agent 定义其能力、工具和角色

### Agent 配置字段

- **id**: Agent 唯一标识
- **type**: Agent 类型（用于路由）
  - 例如：`"coder"`, `"researcher"`, `"analyst"`, `"general"`
- **skillName**: 关联的 Skill 名称（可选）
  - 从 `~/.sbot/skills/` 目录加载
- **tools**: 允许使用的工具列表
  - 使用 `["*"]` 表示允许所有工具
  - 或指定具体工具名称列表
- **systemPrompt**: 系统提示词（可选）
  - 定义 Agent 的角色和专长

## 三种模式对比

### 1. Single Agent 模式（默认）

**适用场景**：
- 简单的单任务处理
- 不需要任务分解
- 向后兼容的默认行为

**配置示例**：
```json
{
  "plan": {
    "mode": "single"
  }
}
```

或者省略 `plan` 配置，系统将自动使用单 Agent 模式。

**执行流程**：
```
用户请求 → Agent 处理 → 返回结果
```

---

### 2. Supervisor 模式

**适用场景**：
- 复杂任务需要分解为多个子任务
- 子任务之间有明确的依赖关系
- 需要预先规划整体执行方案
- 适合结构化、可预测的工作流

**特点**：
- ✅ 预先生成完整的执行计划
- ✅ 支持任务依赖关系
- ✅ 按拓扑顺序执行任务
- ✅ 可以在执行前审批计划
- ❌ 无法根据执行结果动态调整计划

**配置示例**：
```json
{
  "plan": {
    "mode": "supervisor",
    "agents": [
      {
        "id": "coder-1",
        "type": "coder",
        "skillName": "python-developer",
        "tools": ["read_file", "write_file", "execute_command", "web_search"],
        "systemPrompt": "你是一个 Python 开发专家，擅长编写高质量的代码"
      },
      {
        "id": "researcher-1",
        "type": "researcher",
        "tools": ["web_search", "read_url"],
        "systemPrompt": "你是一个信息检索专家，擅长从互联网搜索和分析信息"
      },
      {
        "id": "analyst-1",
        "type": "analyst",
        "tools": ["read_file", "web_search"],
        "systemPrompt": "你是一个数据分析专家，擅长分析和总结信息"
      }
    ]
  }
}
```

**执行流程**：
```
用户请求
  ↓
PLAN 节点 (生成执行计划)
  ↓
SUPERVISOR 节点 (任务调度)
  ↓
Sub-Agent 1 (执行任务 1)
  ↓
Sub-Agent 2 (执行任务 2, 依赖任务 1)
  ↓
Sub-Agent 3 (执行任务 3)
  ↓
AGGREGATOR 节点 (聚合结果)
  ↓
返回最终结果
```

**示例任务**：
"搜索 Python 最佳实践，然后编写一个使用这些实践的示例项目"

生成的计划可能是：
1. **researcher** 搜索 Python 最佳实践（任务 1）
2. **analyst** 分析和总结搜索结果（任务 2，依赖任务 1）
3. **coder** 基于总结编写示例代码（任务 3，依赖任务 2）

---

### 3. ReAct 模式

**适用场景**：
- 任务目标不明确，需要探索
- 需要根据中间结果动态调整策略
- 问题求解需要多轮推理和尝试
- 适合探索性、不确定的任务

**特点**：
- ✅ 迭代式决策，每次只规划下一步
- ✅ 根据执行结果动态调整策略
- ✅ 适合探索性任务
- ✅ 支持设置最大迭代次数防止无限循环
- ❌ 无法预先看到完整计划
- ❌ 可能需要更多 LLM 调用

**配置示例**：
```json
{
  "plan": {
    "mode": "react",
    "maxIterations": 10,
    "agents": [
      {
        "id": "coder-1",
        "type": "coder",
        "tools": ["read_file", "write_file", "execute_command"],
        "systemPrompt": "你是一个开发专家"
      },
      {
        "id": "researcher-1",
        "type": "researcher",
        "tools": ["web_search", "read_url"],
        "systemPrompt": "你是一个研究专家"
      },
      {
        "id": "debugger-1",
        "type": "debugger",
        "tools": ["read_file", "execute_command", "web_search"],
        "systemPrompt": "你是一个调试专家，擅长定位和修复问题"
      }
    ]
  }
}
```

**执行流程**：
```
用户请求
  ↓
THINK 节点 (推理：需要做什么？)
  ↓
ROUTER 节点 (路由决策)
  ↓
Sub-Agent (执行行动)
  ↓
OBSERVE 节点 (记录观察结果)
  ↓
THINK 节点 (推理：下一步做什么？)
  ↓
... (循环，直到完成或达到最大迭代次数)
  ↓
REFLECT 节点 (最终总结)
  ↓
返回结果
```

**示例任务**：
"调查并修复应用中的性能问题"

执行过程可能是：
1. 🤔 **思考**: 需要先了解应用代码结构
2. 🔨 **行动**: **coder** 读取主要代码文件
3. 👀 **观察**: 发现有数据库查询相关代码
4. 🤔 **思考**: 可能是数据库查询导致性能问题，需要搜索优化方法
5. 🔨 **行动**: **researcher** 搜索数据库查询优化技巧
6. 👀 **观察**: 找到了索引优化和查询优化建议
7. 🤔 **思考**: 应该检查当前数据库是否有索引
8. 🔨 **行动**: **debugger** 执行数据库诊断命令
9. 👀 **观察**: 发现缺少关键索引
10. 🤔 **思考**: 需要添加索引
11. 🔨 **行动**: **coder** 编写添加索引的迁移脚本
12. 👀 **观察**: 索引添加成功
13. 🤔 **思考**: 任务完成
14. ✨ **总结**: 通过添加数据库索引优化了查询性能

## 工具权限管理

每个 Agent 可以配置允许使用的工具列表，实现权限隔离：

```json
{
  "tools": ["read_file", "write_file"]  // 只允许文件读写
}
```

或使用通配符允许所有工具：

```json
{
  "tools": ["*"]  // 允许所有工具
}
```

### 常用工具列表

- `read_file` - 读取文件
- `write_file` - 写入文件
- `execute_command` - 执行命令
- `web_search` - 网络搜索
- `read_url` - 读取 URL 内容
- `list_directory` - 列出目录内容
- `create_directory` - 创建目录
- `delete_file` - 删除文件
- 更多工具...（取决于安装的 MCP 服务器）

## 完整配置示例

### Single Agent 模式
```json
{
  "model": "claude",
  "lark": {
    "appId": "your-app-id",
    "appSecret": "your-app-secret"
  },
  "plan": {
    "mode": "single"
  }
}
```

### Supervisor 模式
```json
{
  "model": "claude",
  "lark": {
    "appId": "your-app-id",
    "appSecret": "your-app-secret"
  },
  "plan": {
    "mode": "supervisor",
    "agents": [
      {
        "id": "full-stack-dev",
        "type": "coder",
        "tools": ["*"],
        "systemPrompt": "你是一个全栈开发专家"
      },
      {
        "id": "researcher",
        "type": "researcher",
        "tools": ["web_search", "read_url"],
        "systemPrompt": "你是一个技术研究员"
      }
    ]
  }
}
```

### ReAct 模式
```json
{
  "model": "claude",
  "lark": {
    "appId": "your-app-id",
    "appSecret": "your-app-secret"
  },
  "plan": {
    "mode": "react",
    "maxIterations": 8,
    "agents": [
      {
        "id": "problem-solver",
        "type": "general",
        "tools": ["*"],
        "systemPrompt": "你是一个问题解决专家，擅长分析和解决各类技术问题"
      },
      {
        "id": "code-writer",
        "type": "coder",
        "tools": ["read_file", "write_file", "execute_command"],
        "systemPrompt": "你专注于编写和修改代码"
      },
      {
        "id": "researcher",
        "type": "researcher",
        "tools": ["web_search", "read_url"],
        "systemPrompt": "你专注于搜索和研究技术信息"
      }
    ]
  }
}
```

## 最佳实践

### 1. 选择合适的模式

- **简单任务** → Single Agent
- **可分解的结构化任务** → Supervisor
- **探索性、不确定的任务** → ReAct

### 2. Agent 数量建议

- **Supervisor 模式**: 2-5 个 Agent，每个负责不同领域
- **ReAct 模式**: 3-6 个 Agent，覆盖主要能力

### 3. 工具权限设计

- 遵循最小权限原则
- 研究型 Agent 不需要写文件权限
- 编码型 Agent 需要文件和命令执行权限

### 4. SystemPrompt 编写

- 清晰定义 Agent 的专长和职责
- 避免职责重叠
- 可以指定输出格式要求

### 5. 迭代次数设置（ReAct）

- 简单任务: 3-5 次
- 中等任务: 5-8 次
- 复杂任务: 8-15 次
- 避免设置过大导致成本过高

## 故障排查

### 问题：Agent 无法执行某个工具

**原因**: Agent 的 `tools` 配置中没有包含该工具

**解决**: 在 Agent 配置的 `tools` 列表中添加工具名，或使用 `["*"]` 允许所有工具

### 问题：ReAct 模式提前结束

**原因**: 达到 `maxIterations` 限制

**解决**: 增加 `maxIterations` 值，或优化任务描述使其更明确

### 问题：Supervisor 模式任务卡住

**原因**: 任务依赖关系形成循环，或某个任务一直 PENDING

**解决**: 检查任务依赖关系设计，确保无循环依赖

## 相关文档

- [Skill 系统配置](./skills.md)
- [MCP 工具配置](./mcp.md)
- [模型配置](./models.md)
