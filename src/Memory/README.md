# 长期记忆模块 (Long-term Memory)

完整的 AI Agent 长期记忆实现，支持向量嵌入、语义检索、时间衰减等功能。

## 功能特性

### 核心功能
- ✅ **向量存储**：使用 SQLite + JSON 存储向量嵌入
- ✅ **语义检索**：基于余弦相似度的向量检索
- ✅ **时间衰减**：记忆重要性随时间衰减
- ✅ **混合检索**：结合向量相似度、关键词匹配、时间因素
- ✅ **智能排序**：综合考虑重要性、新鲜度、访问频率
- ✅ **自动清理**：定期清理低价值的过期记忆
- ✅ **批量操作**：支持批量插入和检索

### 记忆类型
- **情节记忆 (Episodic)**：具体的对话和交互历史
- **语义记忆 (Semantic)**：通用知识和事实
- **短期记忆 (Short-term)**：当前会话上下文

## 架构设计

```
┌─────────────────────────────────────────────────┐
│              AgentService                        │
│  ┌───────────────────────────────────────────┐  │
│  │         MemoryService                     │  │
│  │  - 记忆管理                                │  │
│  │  - 智能检索                                │  │
│  │  - 重要性评估                              │  │
│  └──────────────┬────────────────────────────┘  │
│                 │                                │
│  ┌──────────────▼────────────────────────────┐  │
│  │         MemoryDatabase                    │  │
│  │  - SQLite 存储                            │  │
│  │  - 向量检索                                │  │
│  │  - 统计分析                                │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

## 快速开始

### 1. 配置

在 `~/.sbot/settings.toml` 中启用记忆功能：

```toml
[memory]
enabled = true           # 是否启用长期记忆功能
autoCleanup = true       # 是否自动清理过期记忆
maxAgeDays = 90          # 记忆最大保留天数（默认90天）
```

### 2. 使用示例

#### 基本使用（已集成到 AgentService）

```typescript
import { AgentService } from "./Agent/AgentService";
import { config } from "./Config";

// 创建 AgentService（自动启用记忆功能）
const agent = new AgentService(
  "user_123",
  config.getCurrentModel()!,
  skillsDir,
  true  // enableMemory = true
);

// 正常使用 agent.stream()，记忆功能会自动工作
await agent.stream(query, onMessage);

// 记忆会自动：
// 1. 在调用模型前注入相关记忆到提示词
// 2. 在对话结束后保存对话历史
```

#### 手动操作记忆

```typescript
// 获取记忆服务
const memoryService = agent.getMemoryService();

if (memoryService) {
  // 添加语义记忆（长期知识）
  await memoryService.extractSemanticMemory(
    "用户喜欢使用 TypeScript 开发项目"
  );

  // 检索相关记忆
  const memories = await memoryService.retrieveRelevantMemories(
    "用户的编程偏好",
    { limit: 5, useTimeDecay: true }
  );

  // 获取记忆统计
  const stats = agent.getMemoryStatistics();
  console.log(`总记忆数: ${stats.totalCount}`);
  console.log(`情节记忆: ${stats.byType.episodic || 0}`);
  console.log(`语义记忆: ${stats.byType.semantic || 0}`);

  // 清空所有记忆
  await agent.clearMemories();
}
```

#### 独立使用 MemoryService

```typescript
import { MemoryService, MemoryType } from "./Memory";

const memoryService = new MemoryService({
  userId: "user_123",
  dbPath: "/path/to/memory.db",
  embeddingConfig: {
    apiKey: "your-openai-key",
    baseURL: "https://api.openai.com/v1",
    model: "text-embedding-ada-002"
  },
  enableAutoCleanup: true,
  maxMemoryAgeDays: 90
});

// 添加记忆
await memoryService.addMemory(
  "用户在2024年购买了Pro版本",
  MemoryType.SEMANTIC,
  0.9  // 高重要性
);

// 批量添加记忆
await memoryService.batchAddMemories([
  { content: "用户喜欢深色主题", type: MemoryType.SEMANTIC },
  { content: "用户常用的编程语言是 Python", type: MemoryType.SEMANTIC }
]);

// 检索记忆
const memories = await memoryService.retrieveRelevantMemories(
  "用户的偏好设置",
  {
    limit: 5,
    type: MemoryType.SEMANTIC,
    useTimeDecay: true,
    minImportance: 0.5,
    keywords: ["偏好", "设置"]
  }
);

// 获取格式化的记忆摘要
const summary = await memoryService.getMemorySummary("用户信息", 500);
console.log(summary);

// 清理过期记忆
const deletedCount = await memoryService.cleanupOldMemories(30); // 30天
```

## 工作原理

### 1. 记忆存储

```typescript
// 记忆结构
interface Memory {
  id: string;
  type: MemoryType;
  content: string;
  embedding: number[];  // 1536维向量（OpenAI ada-002）
  metadata: {
    timestamp: number;
    userId: string;
    sessionId: string;
    importance: number;     // 0-1
    accessCount: number;
    lastAccessed: number;
    tags?: string[];
  };
}
```

### 2. 检索策略

#### 向量相似度检索
```typescript
// 使用余弦相似度计算
similarity = dotProduct / (||a|| * ||b||)
distance = (1 - similarity) / 2  // 转换为距离 [0, 1]
```

#### 时间衰减
```typescript
// 每小时衰减 0.5%
decayFactor = 0.995
timeDecay = pow(decayFactor, hoursSinceCreation)
decayedScore = vectorSimilarity * timeDecay
```

#### 综合排序
```typescript
finalScore =
  recencyScore * 0.3 +      // 时间新鲜度
  importance * 0.4 +         // 重要性
  accessFrequency * 0.3      // 访问频率
```

### 3. 自动重要性评估

系统会根据以下因素自动评估记忆重要性：

- **关键词检测**：包含"重要"、"关键"、"记住"等词 (+0.3)
- **内容长度**：超过200字符 (+0.1)
- **问题类型**：包含问号 (+0.1)
- **数据信息**：包含数字 (+0.05)

### 4. 自动清理策略

定期清理满足以下条件的记忆：
- 创建时间超过最大保留期（默认90天）
- 重要性低于阈值（< 0.3）
- 访问次数少（< 2次）

## 性能优化

### 1. 索引优化

```sql
-- 自动创建的索引
CREATE INDEX idx_memories_type ON memories(type);
CREATE INDEX idx_memories_created_at ON memories(created_at);
CREATE INDEX idx_memories_user_id ON memories(json_extract(metadata, '$.userId'));
```

### 2. 批量操作

```typescript
// 使用批量插入提高性能
await memoryService.batchAddMemories(items);  // 使用事务
```

### 3. 缓存策略

- 嵌入向量不在检索结果中返回（减少内存占用）
- 使用 WAL 模式提升并发性能

## 数据库管理

### 查看记忆统计

```typescript
const stats = memoryService.getStatistics();
console.log(stats);
// {
//   totalCount: 150,
//   byType: { episodic: 120, semantic: 30 },
//   avgImportance: 0.65,
//   oldestMemory: 1704067200000,
//   newestMemory: 1738281600000
// }
```

### 手动清理

```typescript
// 清理30天前的记忆
await memoryService.cleanupOldMemories(30);

// 清空所有记忆
await memoryService.clearAllMemories();
```

### 数据库优化

```typescript
// 执行 VACUUM 优化数据库
memoryService.optimize();
```

## 文件结构

```
src/Memory/
├── types.ts              # 类型定义
├── MemoryDatabase.ts     # 数据库层（SQLite操作）
├── MemoryService.ts      # 服务层（业务逻辑）
├── index.ts             # 模块导出
└── README.md            # 本文档
```

## 数据存储位置

- 记忆数据库：`~/.sbot/memory/{userId}.db`
- 每个用户独立的数据库文件
- 使用 SQLite WAL 模式保证并发安全

## 最佳实践

### 1. 记忆类型选择

- **EPISODIC**：用于对话历史、具体事件
- **SEMANTIC**：用于长期知识、用户偏好
- **SHORT_TERM**：用于当前会话的临时信息

### 2. 重要性设置

- 0.0 - 0.3：低重要性（临时信息）
- 0.4 - 0.6：中等重要性（一般对话）
- 0.7 - 0.9：高重要性（关键信息）
- 1.0：极高重要性（永久保留）

### 3. 检索优化

```typescript
// 快速检索：纯向量相似度
const memories = await memoryService.retrieveRelevantMemories(query, {
  limit: 5,
  useTimeDecay: false
});

// 精确检索：混合策略
const memories = await memoryService.retrieveRelevantMemories(query, {
  limit: 5,
  useTimeDecay: true,
  keywords: ["关键词1", "关键词2"],
  minImportance: 0.6
});
```

### 4. 定期维护

```typescript
// 建议每天执行一次清理
setInterval(async () => {
  await memoryService.cleanupOldMemories();
  memoryService.optimize();
}, 24 * 3600 * 1000);
```

## 故障排查

### 问题1: 记忆未生效

检查配置：
```toml
[memory]
enabled = true  # 确保已启用
```

检查日志：
```typescript
// 日志中应显示
"记忆服务已启动 - 用户: xxx"
"已注入长期记忆上下文到提示词中"
```

### 问题2: 检索结果不准确

调整检索参数：
```typescript
await memoryService.retrieveRelevantMemories(query, {
  limit: 10,           // 增加返回数量
  useTimeDecay: true,  // 启用时间衰减
  minImportance: 0.5   // 降低重要性阈值
});
```

### 问题3: 数据库文件过大

执行清理：
```typescript
await memoryService.cleanupOldMemories(30);  // 清理30天前的记忆
memoryService.optimize();                     // 优化数据库
```

## 技术细节

### 向量存储

- 使用 JSON 格式存储向量（简单可靠）
- 支持任意维度的向量
- 自动计算余弦相似度

### 未来优化方向

- [ ] 使用 sqlite-vec 扩展（原生向量支持）
- [ ] 支持 HNSW 索引（更快的向量检索）
- [ ] 支持记忆合并和压缩
- [ ] 支持 LLM 驱动的重要性评估
- [ ] 支持跨用户的知识共享

## 参考资料

- [OpenAI Embeddings API](https://platform.openai.com/docs/guides/embeddings)
- [SQLite JSON Functions](https://www.sqlite.org/json1.html)
- [LangChain Memory](https://js.langchain.com/docs/modules/memory/)
