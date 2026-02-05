# 长期记忆高级功能指南

本文档介绍 SBot 长期记忆模块的高级功能，包括 LLM 驱动的智能重要性评估和记忆压缩。

## 目录

- [LLM 驱动的重要性评估](#llm-驱动的重要性评估)
- [记忆压缩和合并](#记忆压缩和合并)
- [配置和使用](#配置和使用)
- [成本考虑](#成本考虑)
- [最佳实践](#最佳实践)

---

## LLM 驱动的重要性评估

### 概述

传统的启发式重要性评估基于关键词匹配等规则，而 LLM 评估能够深入理解内容语义，提供更准确的重要性判断。

### 工作原理

```
用户输入内容
     ↓
发送给 LLM（GPT-3.5-turbo）
     ↓
LLM 分析内容并评分
     ↓
返回：分数 + 理由 + 类别 + 标签
```

### 启用方法

```typescript
import { MemoryService } from "./Memory";

const memoryService = new MemoryService({
  userId: "user_123",
  dbPath: "/path/to/memory.db",
  embeddingConfig: {
    apiKey: "your-openai-key",
    baseURL: "https://api.openai.com/v1"
  },
  enableLLMEvaluation: true,  // 启用 LLM 评估
  compressionModel: "gpt-3.5-turbo"  // 可选：指定模型
});
```

### 使用示例

#### 1. 自动评估（添加记忆时）

```typescript
// 让 LLM 自动评估重要性
const memoryId = await memoryService.addMemory(
  "用户的生日是1990年1月1日，这是非常重要的个人信息",
  MemoryType.SEMANTIC,
  undefined,  // 不提供重要性分数
  {},
  true  // 启用 LLM 评估
);

// LLM 会自动评估并可能给出 0.9 的高分
```

#### 2. 单个评估

```typescript
const evaluator = memoryService.getImportanceEvaluator();

const evaluation = await evaluator.evaluate(
  "用户决定在项目中使用 React 和 TypeScript"
);

console.log(evaluation);
// {
//   score: 0.85,
//   reasoning: "涉及重要的技术决策，影响项目架构",
//   category: "技术决策",
//   tags: ["React", "TypeScript", "技术栈"]
// }
```

#### 3. 批量评估

```typescript
const items = [
  { content: "用户说今天天气不错" },
  { content: "用户的主邮箱是 user@example.com" },
  { content: "用户决定使用 PostgreSQL 数据库" }
];

const results = await evaluator.evaluateBatch(items);

results.forEach((result, index) => {
  console.log(`${items[index].content}`);
  console.log(`  重要性: ${result.score.toFixed(2)}`);
  console.log(`  理由: ${result.reasoning}`);
});
```

### 评分标准

LLM 使用以下标准评估重要性：

| 分数范围 | 说明 | 示例 |
|---------|------|------|
| 0.0-0.3 | 临时信息、闲聊 | "今天天气不错" |
| 0.4-0.6 | 一般对话、普通问题 | "如何使用这个功能？" |
| 0.7-0.8 | 重要决策、用户偏好 | "我喜欢使用 TypeScript" |
| 0.9-1.0 | 极其重要的信息 | "我的密码是..." |

### 对比：启发式 vs LLM 评估

| 内容 | 启发式评估 | LLM 评估 | 说明 |
|------|-----------|---------|------|
| "用户的生日是1990年1月1日" | 0.6 | 0.85 | LLM 理解个人信息重要性 |
| "重要：记住这个" | 0.8 | 0.4 | 启发式被关键词误导 |
| "用户决定采用微服务架构" | 0.5 | 0.9 | LLM 理解架构决策重要性 |
| "用户随口说了句话" | 0.5 | 0.2 | LLM 识别出不重要 |

---

## 记忆压缩和合并

### 概述

随着时间推移，记忆会不断累积。记忆压缩功能可以将多条相关的记忆合并为一条更简洁的记忆，节省存储空间并提高检索效率。

### 压缩策略

#### 1. 按时间顺序（CHRONOLOGICAL）

保持事件的时间线，适合对话历史：

```
原始记忆：
[1] 用户问：React 是什么？
[2] 我回答了 React 的概念
[3] 用户继续问：如何使用 Hooks？
[4] 我解释了 Hooks 的用法

压缩后：
用户询问了 React 的基本概念和 Hooks 用法，我进行了详细解答。
```

#### 2. 按主题（THEMATIC）

将相关信息归类整合：

```
原始记忆：
[1] 用户使用 React 开发前端
[2] 用户的项目用 TypeScript
[3] 用户喜欢函数式编程
[4] 用户使用 React Hooks

压缩后：
用户的技术栈：使用 React + TypeScript 开发前端，偏好函数式编程和 Hooks。
```

#### 3. 按重要性（IMPORTANCE）

保留重要信息，简化次要细节：

```
原始记忆：
[1] 用户的邮箱是 user@example.com (重要性: 0.9)
[2] 用户说收到了一封邮件 (重要性: 0.3)
[3] 用户的备用邮箱是 backup@example.com (重要性: 0.8)

压缩后：
用户的联系方式：主邮箱 user@example.com，备用邮箱 backup@example.com。
```

### 启用方法

```typescript
const memoryService = new MemoryService({
  userId: "user_123",
  dbPath: "/path/to/memory.db",
  embeddingConfig: {
    apiKey: "your-openai-key",
    baseURL: "https://api.openai.com/v1"
  },
  enableCompression: true,  // 启用记忆压缩
  compressionModel: "gpt-3.5-turbo"
});
```

### 使用示例

#### 1. 压缩指定记忆

```typescript
import { MergeStrategy } from "./Memory";

// 手动选择要压缩的记忆
const memoryIds = ["id1", "id2", "id3", "id4"];

const result = await memoryService.compressSpecificMemories(
  memoryIds,
  MergeStrategy.THEMATIC
);

if (result) {
  console.log(`原始记忆数: ${result.sourceMemoryIds.length}`);
  console.log(`压缩后: ${result.compressedMemory.content}`);
  console.log(`压缩比: ${(result.compressionRatio * 100).toFixed(1)}%`);
}
```

#### 2. 自动查找可压缩记忆

```typescript
const compressor = memoryService.getCompressor();

// 获取所有记忆
const allMemories = [...]; // 从数据库获取

// 查找相似度高的记忆组（可以合并）
const groups = compressor.findCompressibleGroups(
  allMemories,
  0.8  // 相似度阈值：80%
);

console.log(`找到 ${groups.length} 个可压缩的记忆组`);

// 压缩每个组
for (const group of groups) {
  const result = await compressor.compress(
    group,
    MergeStrategy.THEMATIC,
    (text) => embeddings.embedQuery(text)
  );

  if (result) {
    console.log(`压缩 ${group.length} 条记忆 -> 1 条`);
  }
}
```

#### 3. 按时间窗口压缩

```typescript
// 压缩7天内的相关记忆
const count = await memoryService.compressMemoriesByTimeWindow(
  7 * 24 * 3600 * 1000,  // 7天
  3,  // 至少3条记忆才压缩
  MergeStrategy.CHRONOLOGICAL
);

console.log(`压缩了 ${count} 组记忆`);
```

### 压缩效果

典型的压缩效果：

| 原始记忆 | 压缩后 | 压缩比 | 信息保留 |
|---------|-------|-------|---------|
| 4条相关对话（共800字） | 1条摘要（约480字） | 60% | ~90% |
| 10条技术决策（共1200字） | 1条总结（约600字） | 50% | ~85% |
| 5条用户偏好（共400字） | 1条整合（约280字） | 70% | ~95% |

---

## 配置和使用

### 完整配置示例

```typescript
import { MemoryService, MemoryType, MergeStrategy } from "./Memory";

const memoryService = new MemoryService({
  // 基础配置
  userId: "user_123",
  dbPath: "/path/to/memory.db",

  // Embedding 配置
  embeddingConfig: {
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: "https://api.openai.com/v1",
    model: "text-embedding-ada-002"
  },

  // 自动清理
  enableAutoCleanup: true,
  maxMemoryAgeDays: 90,

  // 高级功能
  enableLLMEvaluation: true,    // LLM 重要性评估
  enableCompression: true,       // 记忆压缩
  compressionModel: "gpt-3.5-turbo"  // 压缩和评估使用的模型
});
```

### 推荐配置

#### 开发/测试环境

```typescript
{
  enableLLMEvaluation: false,   // 使用启发式评估节省成本
  enableCompression: false,      // 暂不压缩
  enableAutoCleanup: false       // 手动清理
}
```

#### 生产环境（标准）

```typescript
{
  enableLLMEvaluation: false,   // 启发式评估已足够
  enableCompression: true,       // 定期压缩节省空间
  enableAutoCleanup: true,       // 自动清理过期记忆
  compressionModel: "gpt-3.5-turbo"
}
```

#### 生产环境（高精度）

```typescript
{
  enableLLMEvaluation: true,    // 精确评估重要性
  enableCompression: true,       // 智能压缩
  enableAutoCleanup: true,
  compressionModel: "gpt-4"      // 更高质量的压缩
}
```

---

## 成本考虑

### API 调用成本

使用高级功能会产生额外的 API 调用：

#### LLM 重要性评估

| 操作 | API 调用 | 成本（GPT-3.5-turbo） |
|------|---------|---------------------|
| 添加1条记忆（LLM评估） | 1次 | ~$0.0002 |
| 批量评估10条记忆 | 1次 | ~$0.0005 |
| 重新评估已有记忆 | 1次/记忆 | ~$0.0002 |

#### 记忆压缩

| 操作 | API 调用 | 成本（GPT-3.5-turbo） |
|------|---------|---------------------|
| 压缩4条记忆 | 1次 | ~$0.0003 |
| 压缩10条记忆 | 1次 | ~$0.0008 |

#### 估算

假设每天：
- 新增100条记忆（使用 LLM 评估）
- 压缩10组记忆（每组4条）

日成本：
```
评估: 100 × $0.0002 = $0.02
压缩: 10 × $0.0003 = $0.003
总计: ~$0.023/天 ≈ $0.7/月
```

### 优化建议

1. **选择性启用 LLM 评估**
   ```typescript
   // 只对重要类型启用 LLM 评估
   if (type === MemoryType.SEMANTIC) {
     await addMemory(content, type, undefined, {}, true);
   } else {
     await addMemory(content, type, undefined, {}, false);
   }
   ```

2. **批量评估**
   ```typescript
   // 不要逐个评估，使用批量评估
   const evaluations = await evaluator.evaluateBatch(items);
   ```

3. **定期压缩而非实时压缩**
   ```typescript
   // 每周执行一次压缩
   setInterval(async () => {
     await memoryService.compressSimilarMemories(0.8);
   }, 7 * 24 * 3600 * 1000);
   ```

4. **使用更便宜的模型**
   ```typescript
   {
     compressionModel: "gpt-3.5-turbo"  // 而非 gpt-4
   }
   ```

---

## 最佳实践

### 1. 何时使用 LLM 评估

**推荐使用的场景：**
- 语义记忆（SEMANTIC）：长期知识和事实
- 用户明确表示"重要"但启发式评估不准确的情况
- 需要高精度分类的场景

**不推荐使用的场景：**
- 情节记忆（EPISODIC）：普通对话历史
- 临时信息
- 高频记忆添加（会产生大量成本）

### 2. 何时压缩记忆

**适合压缩的记忆：**
- 多条内容相似的记忆（相似度 > 80%）
- 同一主题的多次对话
- 时间跨度较大但主题一致的记忆

**不适合压缩的记忆：**
- 高重要性记忆（> 0.9）
- 包含具体数值、日期的记忆
- 最近添加的记忆（< 7天）

### 3. 压缩策略选择

```typescript
// 对话历史 -> 按时间顺序
await compress(memories, MergeStrategy.CHRONOLOGICAL);

// 技术决策、用户偏好 -> 按主题
await compress(memories, MergeStrategy.THEMATIC);

// 混合内容 -> 按重要性
await compress(memories, MergeStrategy.IMPORTANCE);
```

### 4. 监控和维护

```typescript
// 定期检查压缩效果
const stats = memoryService.getStatistics();
console.log(`总记忆数: ${stats.totalCount}`);
console.log(`平均重要性: ${stats.avgImportance}`);

// 如果记忆数过多，执行压缩
if (stats.totalCount > 1000) {
  await memoryService.compressSimilarMemories(0.85);
}
```

### 5. 备份重要记忆

在压缩前备份高重要性记忆：

```typescript
const compressor = memoryService.getCompressor();

// 只压缩低重要性记忆
const groups = compressor.findCompressibleGroups(
  memories.filter(m => m.metadata.importance < 0.7),
  0.8
);
```

---

## 完整示例

查看完整的使用示例：

- [基础示例](examples/memory-example.ts)
- [高级功能示例](examples/memory-advanced-example.ts)

## 相关文档

- [基础使用指南](MEMORY_GUIDE.md)
- [技术文档](src/Memory/README.md)
- [API 文档](src/Memory/)

---

**高级功能让记忆更智能、更高效！** 🚀
