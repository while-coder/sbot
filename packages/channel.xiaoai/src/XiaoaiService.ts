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

export type XiaoaiAuthMode = 'password' | 'passToken';

export interface XiaoaiMessageArgs extends ChannelMessageArgs {
  accountUserId: string;
  deviceId: string;
  deviceName: string;
}

export interface XiaoaiServiceOptions {
  userId: string;
  mode: XiaoaiAuthMode;
  credential: string;
  loginDeviceId?: string;
  deviceName: string;
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
  private speakerDeviceId: string = '';
  private logger?: ILogger;
  private options: XiaoaiServiceOptions;

  constructor(options: XiaoaiServiceOptions) {
    this.options = options;
    this.logger = options.logger;
  }

  createSessionHandler(session: SessionService): ChannelSessionHandler {
    return new XiaoaiSessionHandler(session, this);
  }

  async sendTextToSession(_sessionId: string, text: string): Promise<void> {
    if (!this.authed || !this.speakerDeviceId) return;
    await speak(this.authed, this.speakerDeviceId, text, {
      chunkLimit: this.options.textChunkLimit,
      volume: this.options.volume,
    });
  }

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
    const { userId, mode, credential, loginDeviceId, deviceName } = this.options;
    const password = mode === 'password' ? credential : '';
    const passToken = mode === 'passToken' ? credential : undefined;

    this.logger?.info(`XiaoAi logging in: ${userId}`);
    this.authed = await login({ userId, password, passToken, deviceId: loginDeviceId });
    this.logger?.info(`XiaoAi logged in: ${userId}`);

    const allDevices = await getDeviceList(this.authed);
    this.logger?.info(`XiaoAi found ${allDevices.length} devices`);

    const matched = findDeviceByName(allDevices, deviceName);
    if (!matched) {
      const available = allDevices.map((d) => d.name).join(', ');
      throw new Error(`Device "${deviceName}" not found. Available: ${available}`);
    }

    this.poller = new MessagePoller(
      this.authed,
      this.options.heartbeat,
      (msg) => this.handleMessage(msg),
      this.logger,
    );
    this.speakerDeviceId = matched.deviceID;
    this.poller.startDevice(matched.deviceID, deviceName);
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
