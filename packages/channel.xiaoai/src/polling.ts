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

export class MessagePoller {
  private states = new Map<string, DevicePollingState>();
  private timers = new Map<string, ReturnType<typeof setInterval>>();

  constructor(
    private account: AuthedAccount,
    private heartbeat: number,
    private onMessage: (msg: PollingMessage) => Promise<void>,
    private logger?: ILogger,
  ) {}

  startDevice(deviceId: string, deviceName: string) {
    if (this.timers.has(deviceId)) return;

    this.states.set(deviceId, {
      deviceId,
      deviceName,
      lastTimestamp: 0,
    });

    const timer = setInterval(() => this.poll(deviceId), this.heartbeat);
    this.timers.set(deviceId, timer);
    this.logger?.info(`XiaoAi polling started: ${deviceName} (${deviceId})`);
  }

  stopDevice(deviceId: string) {
    const timer = this.timers.get(deviceId);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(deviceId);
    }
    this.states.delete(deviceId);
  }

  stopAll() {
    for (const [id] of this.timers) {
      this.stopDevice(id);
    }
  }

  private async poll(deviceId: string) {
    const state = this.states.get(deviceId);
    if (!state) return;

    try {
      const records = await getConversations(this.account, deviceId, 2);
      const newMessages = this.extractNewMessages(state, records);

      for (const msg of newMessages) {
        await this.onMessage(msg);
      }
    } catch (e: any) {
      this.logger?.error(`XiaoAi poll error (${state.deviceName}): ${e.message}`);
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
