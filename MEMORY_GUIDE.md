# SBot 长期记忆功能使用指南

## 概述

SBot 现已集成完整的长期记忆 (Long-term Memory) 功能，能够记住与用户的对话历史和重要信息，并在后续对话中智能检索相关记忆，提供更加个性化和连贯的交互体验。

## 核心特性

### 🧠 智能记忆管理
- **自动记忆**：每次对话自动保存到长期记忆
- **语义检索**：基于向量嵌入的语义相似度搜索
- **时间衰减**：记忆重要性随时间自然衰减
- **智能排序**：综合考虑相关性、重要性、新鲜度和访问频率

### 💾 三种记忆类型
1. **情节记忆 (Episodic)**：对话历史、具体事件
2. **语义记忆 (Semantic)**：长期知识、用户偏好、事实
3. **短期记忆 (Short-term)**：当前会话的临时上下文

### 🔍 高级检索
- **向量相似度搜索**：语义理解，找到真正相关的记忆
- **关键词增强**：精确匹配重要信息
- **混合检索**：结合多种策略获得最佳结果
- **自动清理**：定期清理低价值的过期记忆

## 快速开始

### 1. 启用记忆功能

编辑配置文件 `~/.sbot/settings.toml`，添加记忆配置：

```toml
# 长期记忆配置
[memory]
enabled = true           # 启用长期记忆功能
autoCleanup = true       # 自动清理过期记忆
maxAgeDays = 90          # 记忆最大保留90天
```

### 2. 验证配置

重启 SBot 后，查看日志应该看到：

```
[INFO] 记忆服务已启动 - 用户: user_xxx
[INFO] 用户 user_xxx 的长期记忆服务已启用
```

### 3. 开始使用

正常使用 SBot，记忆功能会自动工作：

```bash
# 第一次对话
> 我喜欢使用 TypeScript 开发项目

# 一段时间后...
> 帮我创建一个新项目

# AI 会记住你的偏好：
# "根据你之前提到的偏好，我将使用 TypeScript 创建项目..."
```

## 工作流程

### 自动记忆流程

```
用户输入
    ↓
检索相关记忆 ────→ 注入到提示词
    ↓
调用 LLM
    ↓
生成响应
    ↓
保存对话记忆
```

### 记忆注入示例

当你问："我之前使用什么语言？"

系统会自动：
1. 生成查询的向量嵌入
2. 搜索相关记忆
3. 将相关记忆注入到提示词中：

```
# 相关记忆

- [episodic] (2天前) User: 我喜欢使用 TypeScript 开发项目
  Assistant: 好的，我记住了...
- [semantic] (5天前) 用户的主要编程语言是 TypeScript
```

## 高级用法

### 手动管理记忆

虽然记忆功能是自动的，但你也可以通过编程接口手动管理：

```typescript
import { AgentService } from "./Agent/AgentService";

const agent = new AgentService(userId, modelConfig, skillsDir, true);

// 获取记忆服务
const memory = agent.getMemoryService();

// 添加重要信息到语义记忆
await memory.extractSemanticMemory(
  "用户的生日是1990年1月1日",
  ["个人信息", "生日"]
);

// 检索相关记忆
const memories = await memory.retrieveRelevantMemories(
  "用户的个人信息",
  {
    limit: 5,
    type: MemoryType.SEMANTIC,
    useTimeDecay: true,
    keywords: ["个人", "生日"]
  }
);

// 获取统计信息
const stats = agent.getMemoryStatistics();
console.log(`总记忆数: ${stats.totalCount}`);
console.log(`平均重要性: ${stats.avgImportance}`);

// 清空所有记忆
await agent.clearMemories();
```

### 重要性控制

你可以为重要信息设置更高的重要性分数（0-1）：

```typescript
// 极高重要性（永久保留）
await memory.addMemory(
  "用户的主要联系方式：xxx@example.com",
  MemoryType.SEMANTIC,
  1.0  // 最高重要性
);

// 低重要性（容易被清理）
await memory.addMemory(
  "用户随口说今天天气不错",
  MemoryType.EPISODIC,
  0.2  // 低重要性
);
```

### 批量操作

高效地批量添加记忆：

```typescript
await memory.batchAddMemories([
  { content: "用户喜欢深色主题", type: MemoryType.SEMANTIC, importance: 0.7 },
  { content: "用户常用的IDE是VSCode", type: MemoryType.SEMANTIC, importance: 0.8 },
  { content: "用户的工作领域是Web开发", type: MemoryType.SEMANTIC, importance: 0.9 }
]);
```

## 配置详解

### 记忆配置项

```toml
[memory]
# 是否启用长期记忆功能（默认：true）
enabled = true

# 是否自动清理过期记忆（默认：true）
# 定期清理低重要性、低访问频率的旧记忆
autoCleanup = true

# 记忆最大保留天数（默认：90天）
# 超过此期限的低价值记忆会被清理
maxAgeDays = 90
```

### 清理策略

自动清理会删除满足以下**所有条件**的记忆：
- 创建时间超过 `maxAgeDays` 天
- 重要性 < 0.3
- 访问次数 < 2

因此，重要的记忆（重要性 >= 0.3）或经常被访问的记忆不会被清理。

## 实际应用场景

### 场景1：记住用户偏好

```
用户：我喜欢使用函数式编程风格
AI：好的，我会记住这个偏好

[几天后]
用户：帮我写一个数组处理函数
AI：我会使用函数式编程风格为你编写，采用 map、filter 等函数式方法...
```

### 场景2：记住项目信息

```
用户：我们的项目叫 MyApp，使用 React + TypeScript
AI：了解了，MyApp 项目使用 React 和 TypeScript

[后续对话]
用户：在项目中添加一个新组件
AI：我将为 MyApp 项目创建一个 React TypeScript 组件...
```

### 场景3：记住技术决策

```
用户：我们决定使用 PostgreSQL 作为数据库
AI：好的，记录了这个技术选型

[几周后]
用户：我需要设计用户表
AI：我将为你设计 PostgreSQL 的用户表结构...
```

### 场景4：记住错误和解决方案

```
用户：上次那个 CORS 错误怎么解决的？
AI：[检索到之前的对话记忆]
根据我们之前的讨论，CORS 错误是通过在后端添加以下配置解决的...
```

## 性能考虑

### 向量嵌入成本

- 每次添加记忆需要调用 OpenAI Embedding API
- 每次检索记忆需要生成查询向量
- 使用 `text-embedding-ada-002`：约 $0.0001 / 1K tokens

### 优化建议

1. **批量操作**：使用 `batchAddMemories` 批量添加记忆
2. **控制检索数量**：设置合理的 `limit` 参数（5-10条）
3. **定期清理**：启用 `autoCleanup` 自动清理过期记忆
4. **数据库优化**：定期调用 `memory.optimize()` 优化数据库

### 存储空间

- 每条记忆约 6-8KB（包括1536维向量）
- 1000条记忆约 6-8MB
- SQLite 数据库自动压缩

## 隐私和安全

### 数据存储

- 记忆数据存储在本地：`~/.sbot/memory/{userId}.db`
- 每个用户独立的数据库文件
- 使用 SQLite 加密可以进一步保护数据

### 数据清理

```typescript
// 清空特定用户的所有记忆
await agent.clearMemories();

// 删除数据库文件
fs.unlinkSync(config.getConfigPath(`memory/${userId}.db`));
```

## 故障排查

### 问题1: 记忆功能未启用

**症状**：对话中没有使用到之前的记忆

**解决方案**：
1. 检查配置文件 `~/.sbot/settings.toml`
   ```toml
   [memory]
   enabled = true
   ```
2. 检查日志是否有启动消息
3. 确保模型配置中有正确的 `apiKey` 和 `baseURL`

### 问题2: 记忆检索不准确

**症状**：检索的记忆与查询不相关

**解决方案**：
1. 增加检索数量：`limit: 10`
2. 使用关键词增强：`keywords: ["关键词1", "关键词2"]`
3. 调整重要性阈值：`minImportance: 0.4`
4. 启用时间衰减：`useTimeDecay: true`

### 问题3: 数据库文件过大

**症状**：`memory/{userId}.db` 文件很大

**解决方案**：
```typescript
// 清理旧记忆
await memory.cleanupOldMemories(30);  // 清理30天前的记忆

// 优化数据库
memory.optimize();
```

### 问题4: Embedding API 错误

**症状**：日志显示 "获取记忆摘要失败"

**解决方案**：
1. 检查 OpenAI API Key 是否有效
2. 检查 `baseURL` 配置是否正确
3. 确认账户有足够的 API 额度
4. 检查网络连接

## 技术实现

### 架构概览

```
┌─────────────────────────────────────────────────┐
│  AgentService (src/Agent/AgentService.ts)       │
│  - 集成记忆功能到对话流程                        │
│  - 自动记忆注入和保存                            │
├─────────────────────────────────────────────────┤
│  MemoryService (src/Memory/MemoryService.ts)    │
│  - 记忆的增删改查                                │
│  - 智能检索和排序                                │
│  - 重要性评估                                    │
├─────────────────────────────────────────────────┤
│  MemoryDatabase (src/Memory/MemoryDatabase.ts)  │
│  - SQLite 数据库操作                             │
│  - 向量相似度计算                                │
│  - 时间衰减算法                                  │
└─────────────────────────────────────────────────┘
```

### 核心算法

**余弦相似度**：
```typescript
similarity = dotProduct(a, b) / (||a|| * ||b||)
distance = (1 - similarity) / 2
```

**时间衰减**：
```typescript
decayFactor = 0.995  // 每小时衰减0.5%
timeDecay = pow(decayFactor, hoursSinceCreation)
```

**综合评分**：
```typescript
finalScore =
  recencyScore * 0.3 +      // 30% 时间新鲜度
  importance * 0.4 +         // 40% 重要性
  accessFrequency * 0.3      // 30% 访问频率
```

## 未来规划

- [ ] 支持记忆合并和压缩
- [ ] LLM 驱动的智能重要性评估
- [ ] 记忆可视化界面
- [ ] 跨用户的知识共享（团队模式）
- [ ] 支持 sqlite-vec 原生向量索引
- [ ] 记忆标签和分类管理
- [ ] 导出/导入记忆功能

## 示例代码

完整的使用示例请参考：[src/Memory/README.md](src/Memory/README.md)

## 相关文件

- `src/Memory/types.ts` - 类型定义
- `src/Memory/MemoryDatabase.ts` - 数据库层
- `src/Memory/MemoryService.ts` - 服务层
- `src/Memory/index.ts` - 模块导出
- `src/Memory/README.md` - 技术文档
- `src/Agent/AgentService.ts` - Agent 集成
- `src/Config.ts` - 配置定义

## 获取帮助

如有问题或建议，请查看：
- 技术文档：`src/Memory/README.md`
- 日志文件：查看应用日志中的记忆相关信息
- 数据库位置：`~/.sbot/memory/{userId}.db`

---

**享受更智能、更个性化的 AI 助手体验！** 🚀
