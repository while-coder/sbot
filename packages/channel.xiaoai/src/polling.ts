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

  startDevice(deviceId: string, deviceName: string) {
    if (this.states.has(deviceId)) return;

    this.states.set(deviceId, {
      deviceId,
      deviceName,
      lastTimestamp: 0,
    });

    this.schedule(deviceId, this.heartbeat);
    this.logger?.info(`XiaoAi polling started: ${deviceName} (${deviceId})`);
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
      const records = await getConversations(this.account, deviceId, 2);
      const newMessages = this.extractNewMessages(state, records);

      for (const msg of newMessages) {
        await this.onMessage(msg);
      }
      this.backoffs.delete(deviceId);
    } catch (e: any) {
      const prev = this.backoffs.get(deviceId);
      nextDelay = Math.min((prev ?? this.heartbeat) * 2, BACKOFF_MAX_MS);
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
      return [];
    }

    const newMsgs: PollingMessage[] = [];
    for (const record of records) {
      if (record.time <= state.lastTimestamp) break;
      if (!record.answers?.[0] || !['TTS', 'LLM'].includes(record.answers[0].type)) continue;
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
