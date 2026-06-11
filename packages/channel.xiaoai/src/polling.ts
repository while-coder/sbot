import { getConversations } from './mi/mina';
import type { AuthedAccount, MiConversation } from './mi/types';
import type { ILogger } from 'channel.base';

export interface PollingMessage {
  text: string;
  timestamp: number;
  deviceId: string;
  deviceName: string;
}

interface DevicePollingState {
  deviceId: string;
  deviceName: string;
  hardware: string;
  lastTimestamp: number;
}

const BACKOFF_MAX_MS = 60_000;

export class MessagePoller {
  private states = new Map<string, DevicePollingState>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private backoffs = new Map<string, number>();

  constructor(
    private account: AuthedAccount,
    private heartbeat: number,
    private onMessage: (msg: PollingMessage) => Promise<void>,
    private logger?: ILogger,
  ) {}

  startDevice(deviceId: string, deviceName: string, hardware: string) {
    if (this.states.has(deviceId)) return;

    this.states.set(deviceId, {
      deviceId,
      deviceName,
      hardware,
      lastTimestamp: 0,
    });

    this.schedule(deviceId, this.heartbeat);
    this.logger?.info(`XiaoAi polling started: ${deviceName} (deviceId=${deviceId}, hardware=${hardware})`);
  }

  stopDevice(deviceId: string) {
    const timer = this.timers.get(deviceId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(deviceId);
    }
    this.states.delete(deviceId);
    this.backoffs.delete(deviceId);
  }

  stopAll() {
    for (const id of [...this.states.keys()]) {
      this.stopDevice(id);
    }
  }

  private schedule(deviceId: string, delay: number) {
    const timer = setTimeout(() => this.poll(deviceId), delay);
    this.timers.set(deviceId, timer);
  }

  private async poll(deviceId: string) {
    this.timers.delete(deviceId);
    const state = this.states.get(deviceId);
    if (!state) return;

    let nextDelay = this.heartbeat;
    try {
      const records = await getConversations(this.account, state.hardware, state.deviceId, 2);
      this.logger?.debug(
        `XiaoAi poll (${state.deviceName}): fetched ${records.length} records, lastTimestamp=${state.lastTimestamp}`,
      );
      const newMessages = this.extractNewMessages(state, records);
      this.logger?.debug(
        `XiaoAi poll (${state.deviceName}): extracted ${newMessages.length} new messages`,
      );

      for (const msg of newMessages) {
        await this.onMessage(msg);
      }
      this.backoffs.delete(deviceId);
    } catch (e: any) {
      const prev = this.backoffs.get(deviceId);
      const base = prev ?? Math.max(this.heartbeat, 1000);
      nextDelay = Math.min(Math.max(base * 2, this.heartbeat), BACKOFF_MAX_MS);
      this.backoffs.set(deviceId, nextDelay);
      this.logger?.error(
        `XiaoAi poll error (${state.deviceName}): ${e.message}, retrying in ${nextDelay}ms`,
      );
    }

    if (this.states.has(deviceId)) {
      this.schedule(deviceId, nextDelay);
    }
  }

  private extractNewMessages(
    state: DevicePollingState,
    records: MiConversation[],
  ): PollingMessage[] {
    if (records.length === 0) return [];

    if (state.lastTimestamp === 0) {
      state.lastTimestamp = records[0].time;
      this.logger?.info(
        `XiaoAi baseline established (${state.deviceName}): lastTimestamp=${records[0].time}, query="${records[0].query}" — first poll never reports messages`,
      );
      return [];
    }

    const newMsgs: PollingMessage[] = [];
    for (const record of records) {
      if (record.time <= state.lastTimestamp) break;
      const answerType = record.answers?.[0]?.type;
      if (!answerType || !['TTS', 'LLM'].includes(answerType)) {
        this.logger?.info(
          `XiaoAi message FILTERED (${state.deviceName}): type="${answerType ?? 'none'}" not in [TTS, LLM], query="${record.query}", time=${record.time}`,
        );
        continue;
      }
      this.logger?.info(
        `XiaoAi message ACCEPTED (${state.deviceName}): type="${answerType}", query="${record.query}", time=${record.time}`,
      );
      newMsgs.push({
        text: record.query,
        timestamp: record.time,
        deviceId: state.deviceId,
        deviceName: state.deviceName,
      });
    }

    if (newMsgs.length > 0) {
      state.lastTimestamp = records[0].time;
    }

    return newMsgs.reverse();
  }
}
