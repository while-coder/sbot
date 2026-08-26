#!/usr/bin/env node
/**
 * 拉取 models.dev 模型目录快照（与 scorpio.llm 运行时的数据源一致：
 * https://models.opencode.ai/api.json），覆盖
 * packages/backend/llm/scorpio.llm/src/assets/models-dev.snapshot.json。
 *
 * 该快照是运行时的兜底数据（无磁盘缓存、无网络时的最后一级），
 * 随包发布，需要定期手动刷新。拉取失败时保留现有快照并正常退出，
 * 不阻断构建。
 *
 * 用法：
 *   pnpm sync:models
 *   node scripts/fetch-models-dev.js
 */
const fs = require('fs');
const path = require('path');

// 与 scorpio.llm/src/capabilities.ts 中的 MODELS_DEV_URL 保持一致
const MODELS_DEV_URL = 'https://models.opencode.ai/api.json';
const FETCH_TIMEOUT_MS = 15000;

const ROOT = path.resolve(__dirname, '..');
const SNAPSHOT_PATH = path.join(
  ROOT,
  'packages/backend/llm/scorpio.llm/src/assets/models-dev.snapshot.json'
);

async function main() {
  const response = await fetch(MODELS_DEV_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`models.dev responded ${response.status}`);
  const catalog = await response.json();

  // 基本校验：顶层为对象，且至少收录了一家 provider 的模型
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
    throw new Error('返回数据不是预期的目录结构');
  }
  const providerCount = Object.keys(catalog).length;
  const modelCount = Object.values(catalog).reduce(
    (sum, entry) => sum + Object.keys(entry?.models ?? {}).length,
    0
  );
  if (providerCount === 0 || modelCount === 0) throw new Error('返回目录为空');

  fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(catalog), 'utf-8');
  console.log(`✓ 已更新模型目录快照：${providerCount} 家 provider / ${modelCount} 个模型`);
}

main().catch(error => {
  console.warn(`⚠ 模型目录拉取失败（${MODELS_DEV_URL}）：${error.message}，保留现有快照`);
});
