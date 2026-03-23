# scorpio.di 拆分设计

## 目标

将 scorpio.ai 中的 DI（依赖注入）系统提取为独立包 `scorpio.di`，使其可被 CLI 等其他项目单独引用，同时 scorpio.ai 依赖 scorpio.di。

## 方案选择

**采用方案 B**：移动所有 DI 实现文件到 scorpio.di，删除 scorpio.ai/src/DI/ 目录，更新所有内部 import 指向 `scorpio.di`。

## 新包结构

```
packages/scorpio.di/
  src/
    ServiceContainer.ts   ← 从 scorpio.ai/src/DI/ 移动
    decorators.ts         ← 移动
    types.ts              ← 移动
    index.ts              ← 移动（公共 API）
  package.json
  tsconfig.json
```

## 变更范围

### 新建

- `packages/scorpio.di/` — 新包，包含 4 个 DI 文件
- `packages/scorpio.di/package.json` — `{ name: "scorpio.di", dependencies: { reflect-metadata } }`
- `packages/scorpio.di/tsconfig.json` — 同 scorpio.ai 风格，需要 `experimentalDecorators` + `emitDecoratorMetadata`

### 删除

- `packages/scorpio.ai/src/DI/ServiceContainer.ts`
- `packages/scorpio.ai/src/DI/decorators.ts`
- `packages/scorpio.ai/src/DI/types.ts`
- `packages/scorpio.ai/src/DI/index.ts`

### 修改

- `packages/scorpio.ai/package.json` — 新增依赖 `"scorpio.di": "workspace:*"`
- `packages/scorpio.ai/tsconfig.json` — 新增 `references: [{ path: "../scorpio.di" }]`
- 所有在 scorpio.ai/src 内 import 自 `../DI`、`../../DI` 等的文件改为 `import from 'scorpio.di'`
- `packages/scorpio.ai/src/Core/index.ts` — 不变（tokens 保留在 scorpio.ai）
- `packages/scorpio.ai/src/index.ts` — DI re-export 改为来自 `scorpio.di`
- 根目录 `package.json` build:deps 脚本 — 在 scorpio.ai 之前先 build scorpio.di

## 受影响的 scorpio.ai 内部文件（需更新 import）

import 路径含 `DI` 的文件（约 18 个）：
- `src/Agents/Single/SingleAgentService.ts`
- `src/Agents/ReAct/ReActAgentService.ts`
- `src/Memory/Service/MemoryService.ts`
- `src/Memory/Compressor/MemoryCompressor.ts`
- `src/Memory/Extractor/MemoryExtractor.ts`
- `src/Memory/Evaluator/MemoryEvaluator.ts`
- `src/Memory/Storage/MemorySqliteDatabase.ts`
- `src/Model/IModelService.ts`
- `src/Skills/SkillService.ts`
- `src/AgentTool/AgentToolService.ts`
- `src/Saver/AgentSqliteSaver.ts`
- `src/Saver/AgentPostgresSaver.ts`
- `src/Saver/AgentFileSaver.ts`
- `src/Core/index.ts`
- `src/index.ts`
- 其他含 DI import 的文件

## 构建顺序

```
scorpio.di → scorpio.ai → sbot.commons → channel.* → sbot → sbot-cli
```

## 不变范围

- `packages/scorpio.ai/src/Core/tokens.ts` — Symbol tokens 保留在 scorpio.ai
- sbot 及其他包无需改动（通过 scorpio.ai 间接使用 DI）
- pnpm-workspace.yaml — `packages/*` 已覆盖新包，无需修改
