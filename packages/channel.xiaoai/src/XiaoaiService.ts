import {
  IChannelService, ChannelSessionHandler, SessionService,
  type ChannelMessageArgs, type ILogger, type MessageContent,
} from 'channel.base';
import { XiaoaiAPI, XiaoaiAuthMode } from './XiaoaiAPI';
import { MessagePoller, type PollingMessage } from './polling';
import { XiaoaiSessionHandler } from './XiaoaiSessionHandler';
import type { MiNADevice } from './types';

export interface XiaoaiMessageArgs extends ChannelMessageArgs {
  accountUserId: string;
  /** 音箱在米家里的别名，用于组装 sessionName；deviceID 见继承来的 sessionId */
  deviceName: string;
}

export interface XiaoaiServiceOptions {
  userId: string;
  authMode: XiaoaiAuthMode;
  credential: string;
  loginDeviceId?: string;
  /** 要接入的音箱名称/别名/deviceID 列表，一个频道可同时绑定多台 */
  deviceNames: string[];
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

  /** sessionId 就是音箱 deviceID；校验它属于本频道已启动的音箱，避免把库里的历史值当设备用 */
  async sendTextToSession(sessionId: string, text: string): Promise<void> {
    if (!this.poller?.hasDevice(sessionId)) {
      this.logger?.warn(`XiaoAi sendTextToSession: unknown session ${sessionId}`);
      return;
    }
    await this.api.speak(sessionId, text, {
      chunkLimit: this.options.textChunkLimit,
      volume: this.options.volume,
    });
  }

  async start(): Promise<void> {
    const { userId, deviceNames } = this.options;

    const allDevices = await this.api.getDeviceList();
    const available = allDevices
      .map((d) => (d.alias && d.alias !== d.name ? `${d.name} (${d.alias})` : d.name))
      .join(', ');

    // deviceID 去重：多个配置项（名称、别名、deviceID）可能指向同一台音箱
    const matched = new Map<string, MiNADevice>();
    const missing: string[] = [];
    for (const deviceName of deviceNames) {
      // 配置值可以是米家里的名称/别名，也可以是 deviceID / miotDID
      const matches = allDevices.filter(
        (d) => d.name === deviceName || d.alias === deviceName
          || d.deviceID === deviceName || d.miotDID === deviceName,
      );
      if (matches.length === 0) {
        missing.push(deviceName);
        continue;
      }
      if (matches.length > 1) {
        this.logger?.warn(
          `XiaoAi: "${deviceName}" matched ${matches.length} devices, using deviceId=${matches[0].deviceID}. `
          + '改填 deviceID 可精确指定。',
        );
      }
      matched.set(matches[0].deviceID, matches[0]);
    }

    if (matched.size === 0) {
      throw new Error(`Device "${deviceNames.join('", "')}" not found. Available: ${available}`);
    }
    // 部分匹配失败只告警：一台音箱下线/改名不应拖垮同频道其余音箱
    if (missing.length > 0) {
      this.logger?.warn(
        `XiaoAi: device(s) not found, skipped: "${missing.join('", "')}". Available: ${available}`,
      );
    }

    this.poller = new MessagePoller(
      this.api,
      this.options.heartbeat,
      (msg) => this.handleMessage(msg),
      this.logger,
    );
    const started: string[] = [];
    for (const device of matched.values()) {
      const displayName = device.alias || device.name || device.deviceID;
      this.poller.startDevice(device.deviceID, displayName, device.hardware);
      started.push(`${displayName}(deviceId=${device.deviceID}, hardware=${device.hardware})`);
    }
    this.logger?.info(
      `XiaoAi started: userId=${userId}, ${matched.size} device(s): ${started.join(', ')}`,
    );
  }

  private async handleMessage(msg: PollingMessage): Promise<void> {
    const { userId } = this.options;
    const eventId = `xiaoai_${userId}_${msg.deviceId}_${msg.timestamp}`;
    if (!(await this.options.filterEvent(eventId))) return;

    await this.options.onReceiveMessage(
      {
        // 用 deviceId 而非名称做 sessionId：音箱在米家里改名后会话不断裂
        sessionId: msg.deviceId,
        accountUserId: userId,
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
