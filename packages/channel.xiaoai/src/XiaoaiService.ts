import {
  IChannelService, ChannelSessionHandler, SessionService,
  type ChannelMessageArgs, type ILogger, type MessageContent,
} from 'channel.base';
import { login } from './mi/account';
import { getDeviceList, findDeviceByName } from './mi/mina';
import { MessagePoller, type PollingMessage } from './polling';
import { speak } from './speaker';
import type { AuthedAccount } from './mi/types';
import { XiaoaiSessionHandler } from './XiaoaiSessionHandler';

export interface XiaoaiMessageArgs extends ChannelMessageArgs {
  accountUserId: string;
  deviceId: string;
  deviceName: string;
}

export interface XiaoaiServiceOptions {
  userId: string;
  password: string;
  device: string;
  heartbeat: number;
  textChunkLimit: number;
  volume?: number;
  logger?: ILogger;
  filterEvent: (eventId: string) => Promise<boolean>;
  onReceiveMessage: (args: XiaoaiMessageArgs, query: MessageContent) => Promise<void>;
}

export class XiaoaiService implements IChannelService {
  private authed: AuthedAccount | undefined;
  private poller: MessagePoller | undefined;
  private deviceId: string = '';
  private logger?: ILogger;
  private options: XiaoaiServiceOptions;

  constructor(options: XiaoaiServiceOptions) {
    this.options = options;
    this.logger = options.logger;
  }

  createSessionHandler(session: SessionService): ChannelSessionHandler {
    return new XiaoaiSessionHandler(session, this);
  }

  async sendText(_sessionId: string, text: string): Promise<void> {
    if (!this.authed || !this.deviceId) return;
    await speak(this.authed, this.deviceId, text, {
      chunkLimit: this.options.textChunkLimit,
      volume: this.options.volume,
    });
  }
  async sendFile(_sessionId: string, _file: string | Buffer, _fileName?: string): Promise<void> {}
  async sendNative(_sessionId: string, _payload: any): Promise<void> {}

  getAuthedAccount(): AuthedAccount | undefined {
    return this.authed;
  }

  get textChunkLimit(): number {
    return this.options.textChunkLimit;
  }

  get volume(): number | undefined {
    return this.options.volume;
  }

  async start(): Promise<void> {
    const { userId, password, device } = this.options;

    this.logger?.info(`XiaoAi logging in: ${userId}`);
    this.authed = await login({ userId, password });
    this.logger?.info(`XiaoAi logged in: ${userId}`);

    const allDevices = await getDeviceList(this.authed);
    this.logger?.info(`XiaoAi found ${allDevices.length} devices`);

    const matched = findDeviceByName(allDevices, device);
    if (!matched) {
      const available = allDevices.map((d) => d.name).join(', ');
      throw new Error(`Device "${device}" not found. Available: ${available}`);
    }

    this.poller = new MessagePoller(
      this.authed,
      this.options.heartbeat,
      (msg) => this.handleMessage(msg),
      this.logger,
    );
    this.deviceId = matched.deviceID;
    this.poller.startDevice(matched.deviceID, device);
  }

  private async handleMessage(msg: PollingMessage): Promise<void> {
    const { userId } = this.options;
    const eventId = `xiaoai_${userId}_${msg.deviceId}_${msg.timestamp}`;
    if (!(await this.options.filterEvent(eventId))) return;

    const sessionId = `xiaoai:${userId}:${msg.deviceName}`;
    await this.options.onReceiveMessage(
      {
        sessionId,
        accountUserId: userId,
        deviceId: msg.deviceId,
        deviceName: msg.deviceName,
      },
      msg.text,
    );
  }

  dispose() {
    this.poller?.stopAll();
    this.poller = undefined;
  }
}
