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

    // 配置值可以是米家里的名称/别名，也可以是 deviceID / miotDID
    const matches = allDevices.filter(
      (d) => d.name === deviceName || d.alias === deviceName
        || d.deviceID === deviceName || d.miotDID === deviceName,
    );
    if (matches.length === 0) {
      const available = allDevices
        .map((d) => (d.alias && d.alias !== d.name ? `${d.name} (${d.alias})` : d.name))
        .join(', ');
      throw new Error(`Device "${deviceName}" not found. Available: ${available}`);
    }
    const matched = matches[0];
    if (matches.length > 1) {
      this.logger?.warn(
        `XiaoAi: "${deviceName}" matched ${matches.length} devices, using deviceId=${matched.deviceID}. `
        + '改填 deviceID 可精确指定。',
      );
    }
    const displayName = matched.alias || matched.name || deviceName;

    this.poller = new MessagePoller(
      this.api,
      this.options.heartbeat,
      (msg) => this.handleMessage(msg),
      this.logger,
    );
    this.api.setSpeakerDeviceId(matched.deviceID);
    this.poller.startDevice(matched.deviceID, displayName, matched.hardware);
    this.logger?.info(
      `XiaoAi started: userId=${userId}, deviceName=${displayName}, deviceId=${matched.deviceID}, hardware=${matched.hardware}`,
    );
  }

  private async handleMessage(msg: PollingMessage): Promise<void> {
    const { userId } = this.options;
    const eventId = `xiaoai_${userId}_${msg.deviceId}_${msg.timestamp}`;
    if (!(await this.options.filterEvent(eventId))) return;

    // 用 deviceId 而非名称：音箱在米家里改名后会话不断裂
    const sessionId = `xiaoai:${userId}:${msg.deviceId}`;
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
