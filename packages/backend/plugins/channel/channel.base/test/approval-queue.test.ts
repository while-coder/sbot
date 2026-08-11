/**
 * 审批/询问交互队列回归测试。
 *
 * 验证本次改造的核心并发语义（SessionService FIFO 队列 + ChannelSessionHandler 推 UI 时机）：
 *   1. 主/子 agent 并发触发的审批被串行展示，用户逐个点击；
 *   2. 批准/拒绝某项后立即提升下一个队首；executeApproval 的返回值与点击一致；
 *   3. abort 清空整条队列，全部待审批 resolve 成 Deny；
 *   4. 计时从“成为队首（展示）”起算 —— 队列中尚未展示的项不提前计时；
 *   5. 审批与询问共用同一条交互队列，统一串行展示。
 *
 * 直接跑 src（tsx 转译），scorpio.ai 走已构建的 dist。
 * 运行：pnpm -F channel.base test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ToolApproval, type ChatToolCall } from 'scorpio.ai';
import { SessionService } from '../src/SessionService';
import { ChannelSessionHandler, ToolCallStatus } from '../src/ChannelSessionHandler';

// onActivate 经 queueMicrotask 推 UI；setTimeout(0) 是宏任务，足以排在其后
const tick = () => new Promise<void>(r => setTimeout(r, 0));
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const tc = (name: string, id: string): ChatToolCall => ({ id, name, args: {} } as any);

/** 只用到审批/询问相关方法；MessageDispatcher 的 abstract 给空实现以便实例化。 */
class TestSession extends SessionService {
  protected async onProcessStart() { return; }
  protected async processAI() { return; }
  protected async getAllCommands() { return [] as any; }
  protected async onCommandResult() { return; }
  protected async onProcessEnd() { return; }
}

/** 捕获“被展示”的顺序，并手动 resolve（不自动同意）。 */
class TestHandler extends ChannelSessionHandler {
  shownIds: string[] = [];
  shownTools: string[] = [];
  shownAskIds: string[] = [];

  async onProcessStart() { return; }
  async onProcessEnd() { return; }

  protected async enterApproval(id: string, _remainSec: number, toolCall: ChatToolCall) {
    this.shownIds.push(id);
    this.shownTools.push(toolCall.name);
  }
  protected async exitApproval(_id: string) {}
  protected async enterAsk(id: string, _remainSec: number) { this.shownAskIds.push(id); }
  protected async exitAsk(_id: string) {}

  approve(id: string, status: ToolCallStatus = ToolCallStatus.Allow) { this.resolveApproval(id, status); }
  answer(id: string) { this.resolveAsk(id, {}); }
}

test('并发审批串行展示，逐个 resolve，返回值与点击一致', async () => {
  const h = new TestHandler(new TestSession('t1'));
  const p1 = h.executeApproval(tc('read', 'a1'));
  const p2 = h.executeApproval(tc('shell', 'a2'));
  const p3 = h.executeApproval(tc('grep', 'a3'));

  await tick();
  assert.equal(h.shownIds.length, 1, '同一时刻只展示队首');
  assert.equal(h.shownTools[0], 'read');

  h.approve(h.shownIds[0], ToolCallStatus.Allow);
  assert.equal(await p1, ToolApproval.Allow);
  await tick();
  assert.equal(h.shownTools.join(','), 'read,shell', '队首处理完才提升下一个');

  h.approve(h.shownIds[1], ToolCallStatus.Deny);
  assert.equal(await p2, ToolApproval.Deny);
  await tick();
  assert.equal(h.shownTools.join(','), 'read,shell,grep');

  h.approve(h.shownIds[2], ToolCallStatus.AlwaysTool);
  assert.equal(await p3, ToolApproval.AlwaysTool);
});

test('abort 清空整条队列，全部 Deny', async () => {
  const session = new TestSession('t2');
  const h = new TestHandler(session);
  const ps = [tc('a', '1'), tc('b', '2'), tc('c', '3')].map(t => h.executeApproval(t));

  await tick();
  assert.equal(h.shownIds.length, 1);

  session.abort();
  assert.deepEqual(await Promise.all(ps), [ToolApproval.Deny, ToolApproval.Deny, ToolApproval.Deny]);
});

test('计时从展示开始：队列中未展示项不提前计时', async () => {
  const h = new TestHandler(new TestSession('t3'));
  h.approvalTimeoutMs = 80;
  h.approvalTimeoutValue = ToolApproval.Deny;

  const pA = h.executeApproval(tc('A', '1'));
  const pB = h.executeApproval(tc('B', '2'));

  await tick();
  assert.equal(h.shownTools.join(','), 'A', '仅队首 A 展示并开始计时');
  await sleep(50);
  assert.equal(h.shownTools.join(','), 'A', 'A 超时前 B 不展示、不计时');

  // A 在 ~80ms 超时 Deny；之后 B 才被提升展示并开始它自己的 80ms 计时
  assert.equal(await pA, ToolApproval.Deny);
  await tick();
  assert.equal(h.shownTools.join(','), 'A,B', 'A 结束后 B 才展示');
  assert.equal(await pB, ToolApproval.Deny, 'B 展示后才计时、再超时');
});

test('审批与询问共用一条交互队列，统一串行展示', async () => {
  const h = new TestHandler(new TestSession('t4'));
  const pApproval = h.executeApproval(tc('shell', '1'));
  const pAsk = h.executeAsk({ title: 'q', questions: [] } as any);

  await tick();
  assert.equal(h.shownIds.length, 1, '队首审批展示');
  assert.equal(h.shownAskIds.length, 0, '询问在队列等待，未展示');

  h.approve(h.shownIds[0], ToolCallStatus.Allow);
  await pApproval;
  await tick();
  assert.equal(h.shownAskIds.length, 1, '审批处理完，询问才展示');

  h.answer(h.shownAskIds[0]);
  await pAsk;
});
