# channel.base 设计文档

**日期:** 2026-03-18

## 背景

`channel.lark` 和 `channel.slack` 两个包存在大量重复代码，主要集中在：
- `ToolCallStatus` 枚举（两份完全相同）
- `executeAgentTool` 的轮询循环和状态映射逻辑
- `ask` 的 questionMap 构建、等待循环、响应提取逻辑

引入 `channel.base` 包，将公共代码统一管理。

## 目标

创建 `packages/channel.base`，包含：
1. 共享类型：`ToolCallStatus` 枚举、`ToolCallState`/`AskState` 接口
2. 抽象基类 `ChannelUserServiceBase`，实现平台无关的核心逻辑

## 架构

### 依赖关系

```
channel.lark  ─→  channel.base  ─→  scorpio.ai
channel.slack ─→  channel.base  ─→  scorpio.ai
```

### 文件结构

```
packages/channel.base/
  src/
    ChannelUserServiceBase.ts
    index.ts
  package.json
  tsconfig.json
```

## ChannelUserServiceBase 接口设计

### 共享类型（迁入）

```ts
export enum ToolCallStatus {
  None = "none", Wait = "wait", Allow = "allow",
  AlwaysArgs = "alwaysArgs", AlwaysTool = "alwaysTool", Deny = "deny",
}

interface ToolCallState { id: string | undefined; status: ToolCallStatus; }
interface AskState { id: string | undefined; status: 'wait'|'done'|'timeout'; questionMap: Record<string,string>; response?: AskResponse; }
```

### 实现的方法（从两个包迁入）

- `executeAgentTool(toolCall)` — 30s 超时轮询 + `statusToApproval` 映射
- `ask(params)` — questionMap 构建、5min 等待循环
- `protected resolveAskResponse(answers)` — 辅助方法，子类在 `onTriggerAction` 中调用以更新 askState

### 新增 abstract 方法（子类实现平台 UI）

```ts
protected abstract sendApprovalUI(toolCall: AgentToolCall, remainSec: number): Promise<void>
protected abstract clearApprovalUI(): Promise<void>
protected abstract sendAskForm(params: AskToolParams, askId: string, questionMap: Record<string,string>): Promise<void>
protected abstract clearAskForm(): Promise<void>
```

### 保留在子类中（不迁移）

- `startProcessMessage()` — 平台初始化差异大
- `processMessageError()` — 依赖各自 provider
- `onAgentStreamMessage()` / `onAgentMessage()` — 短小且依赖各自 provider
- `onTriggerAction()` — 平台事件格式差异大

## 迁移步骤

1. 创建 `packages/channel.base`（package.json、tsconfig.json、src/）
2. 实现 `ChannelUserServiceBase`
3. 更新 `LarkUserServiceBase`：继承新基类，实现 4 个 abstract 方法，删除重复代码
4. 更新 `SlackUserServiceBase`：继承新基类，实现 4 个 abstract 方法，删除重复代码
5. 更新两个包的 package.json 和 tsconfig.json 添加依赖
6. 更新 workspace tsconfig（如有）
