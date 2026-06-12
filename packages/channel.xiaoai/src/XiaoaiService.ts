import {
  IChannelService, ChannelSessionHandler, SessionService,
  type ChannelMessageArgs, type ILogger, type MessageContent,
} from 'channel.base';
import { XiaoaiAPI, XiaoaiAuthMode } from './XiaoaiAPI';
import { MessagePoller, type PollingMessage } from './polling';
import { XiaoaiSessionHandler } from './XiaoaiSessionHandler';

export interface XiaoaiMessageArgs extends ChannelMessageArgs {
  accountUserId: string;
  deviceId: string;
  deviceName: string;
}

export interface XiaoaiServiceOptions {
  userId: string;
  authMode: XiaoaiAuthMode;
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
  private api: XiaoaiAPI;
  private poller: MessagePoller | undefined;
  private logger?: ILogger;
  private options: XiaoaiServiceOptions;

  constructor(options: XiaoaiServiceOptions) {
    this.options = options;
    this.logger = options.logger;
    this.api = new XiaoaiAPI({
      userId: options.userId,
      authMode: options.authMode,
      credential: options.credential,
      deviceId: options.loginDeviceId,
    });
  }

  createSessionHandler(session: SessionService): ChannelSessionHandler {
    return new XiaoaiSessionHandler(session, this);
  }

  async sendTextToSession(_sessionId: string, text: string): Promise<void> {
    await this.api.speak(text, {
      chunkLimit: this.options.textChunkLimit,
      volume: this.options.volume,
    });
  }

  async start(): Promise<void> {
    const { userId, deviceName } = this.options;

    const allDevices = await this.api.getDeviceList();

    const matched = allDevices.find((d) => d.name === deviceName || d.alias === deviceName);
    if (!matched) {
      const available = allDevices.map((d) => d.name).join(', ');
      throw new Error(`Device "${deviceName}" not found. Available: ${available}`);
    }

    this.poller = new MessagePoller(
      this.api,
      this.options.heartbeat,
      (msg) => this.handleMessage(msg),
      this.logger,
    );
    this.api.setSpeakerDeviceId(matched.deviceID);
    this.poller.startDevice(matched.deviceID, deviceName, matched.hardware);
    this.logger?.info(
      `XiaoAi started: userId=${userId}, deviceName=${deviceName}, deviceId=${matched.deviceID}, hardware=${matched.hardware}`,
    );
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
