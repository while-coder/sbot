# sbot 文档

## 配置文档

- **[Plan 模式配置](./plan-config.md)** - 多 Agent 协同和计划功能配置说明
  - Single Agent 模式
  - Supervisor 模式（任务分解和依赖执行）
  - ReAct 模式（迭代推理和行动）

## 配置文件位置

所有配置文件位于 `~/.sbot/` 目录：

- `settings.json` - 主配置文件
- `settings.json.example` - 配置示例文件（每次启动自动生成）
- `mcp.json` - MCP 服务器配置
- `mcp.json.example` - MCP 配置示例文件（每次启动自动生成）
- `skills/` - Skill 技能定义目录
- `memories/` - 长期记忆存储目录

## 快速开始

### 1. 单 Agent 模式（默认）

最简单的配置，适合日常使用：

```json
{
  "model": "claude",
  "models": {
    "claude": {
      "provider": "anthropic",
      "apiKey": "your-api-key",
      "model": "claude-3-opus-20240229"
    }
  }
}
```

### 2. Supervisor 模式

适合需要任务分解的复杂场景：

```json
{
  "model": "claude",
  "plan": {
    "mode": "supervisor",
    "agents": [
      {
        "id": "coder",
        "type": "coder",
        "tools": ["*"],
        "systemPrompt": "你是开发专家"
      },
      {
        "id": "researcher",
        "type": "researcher",
        "tools": ["web_search", "read_url"],
        "systemPrompt": "你是研究专家"
      }
    ]
  }
}
```

### 3. ReAct 模式

适合探索性任务和问题求解：

```json
{
  "model": "claude",
  "plan": {
    "mode": "react",
    "maxIterations": 8,
    "agents": [
      {
        "id": "problem-solver",
        "type": "general",
        "tools": ["*"],
        "systemPrompt": "你是问题解决专家"
      }
    ]
  }
}
```

## 详细文档

查看各个配置的详细说明，请访问对应的文档文件。
