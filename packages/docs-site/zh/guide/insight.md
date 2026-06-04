# Insight 洞察

Agent 编辑页 → **Insight** 区块

Insight 是一个静默后置提取器，每轮对话结束后自动运行，将持久价值的知识 —— 用户偏好、项目事实、经验教训 —— 提炼为可复用的 Markdown 笔记。后续对话开始时，相关 Insight 会通过关键词 + 语义混合检索自动注入到系统提示词中。

可以把它理解为：Agent 在每次对话中主动学习，无需你显式教它。

## 工作原理

每轮对话之后，**提取模型** 会静默审阅最新交互并选择执行：

- **`create`** —— 一条值得保留的新事实
- **`patch`** —— 修订或细化已有 Insight
- **`delete`** —— 撤销被证明错误的 Insight
- **`skip`** —— 本轮没有值得提取的内容

Insight 以 `SKILL.md` 文件形式存于 `~/.sbot/insights/`（按 Agent 或按 Session 隔离，取决于配置）。

## 配置项

| 字段 | 说明 |
|-------|-------------|
| Scope | `Disabled` 关闭 / `Per Agent` 该 Agent 跨会话共享 / `Per Session` 按线程隔离 |
| 提取模型 | 用于运行后置提取的模型 —— 通常选成本低、速度快的小模型 |
| 提取提示词 | 来自 `~/.sbot/prompts/insight/extractor/` 的提示词文件，控制 **提取什么** |

## 生命周期

Insight 会自动老化淘汰：

- **陈旧**（默认 30 天未使用）—— 标记但仍可被检索到
- **归档**（默认 90 天未使用）—— 移出活跃检索；归档保留在磁盘

这样 Insight 池保持新鲜，无需手动清理。

## Insight vs Notes vs Wiki

| | 写入方 | 写入时机 |
|---|-------------|---------------|
| [Insight](./insight) | 静默提取 Agent | 对话轮次后自动 |
| [Notes](./note) | 当前 Agent | 对话过程中按需通过工具调用 |
| [Wiki](./wiki) | 人工为主 + Agent | 编纂式；Agent 也可创建 / 编辑 |

三者中 Insight 最 "设置完即忘"。
