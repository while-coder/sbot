# Memory（记忆）

侧栏 → **Memory Profiles**（位于 **Tasks** 分组），再在 Agent 编辑页 → **Memory** 中按 Agent 开启。

Memory 是 Agent 的自动长期记忆。后台 **MemoryLLM** 会在每次对话空闲后回顾对话，把持久价值的知识 —— 用户偏好、项目事实、决策、经验教训 —— 提炼成记忆条目。在后续对话中，Agent 通过 `search_memory` 和 `read_memory` 工具把它们读回来。

可以把它理解为：Agent 从每次对话中自我学习，无需你显式教学，也不会撑爆系统提示词。

## 工作原理

1. **提取** —— 对话空闲后，**writer 模型** 静默回顾对话并写入新记忆（或更新 / 删除已有记忆）。
2. **读取** —— 后续对话中 Agent 调用：
   - `search_memory` —— 在已存记忆中做模糊 / 关键词 / 语义查找
   - `read_memory` —— 按 slug 读取某条记忆的完整内容
3. **维护** —— 后台任务保持记忆库健康：
   - **Consolidate（合并）** —— 合并、去重相关记忆
   - **Reconcile（校正）** —— 重建索引、清理陈旧条目
4. **删除** —— 被删除的记忆移到 `.archive/`，可恢复。

## 配置项

**Memory Profile** 定义记忆如何被提取与读取。侧栏 → **Memory Profiles** → 新建：

| 字段 | 说明 |
|-------|-------------|
| 名称 | 该 Profile 的显示名称 |
| 启用 | 暂停该 Profile，而不删除配置 |
| Writer 模型 | 用于提取记忆的 MemoryLLM（推荐有推理能力的模型） |
| Writer 提示词 | 控制 **提取什么** |
| Read 提示词 | 召回的记忆如何回填进提示词 |

随后在 Agent → **Memory** 区块开启 Memory 并选择 Profile。在 Memory Profiles 页面可以 **查看记忆**、检查 pending / failed 后台任务、对失败的抽取任务点 **重新抽取**，也可以用 **整理记忆** 排队合并/压缩现有记忆，用 **同步文件索引** 重新扫描文件与索引。

## Memory vs Notes vs Wiki

| | 写入方 | 写入时机 |
|---|-------------|---------------|
| [Memory](./memory) | 后台 MemoryLLM | 对话空闲后自动写入 |
| [Notes](./note) | 人 / 运维者 | 手动写入，随后自动注入或通过 `note_search` 召回 |
| [Wiki](./wiki) | 人 / Wiki 数据源插件 | 编纂后的页面供 Agent 搜索 / 读取 |

三者中 Memory 最"省心、自动"。
