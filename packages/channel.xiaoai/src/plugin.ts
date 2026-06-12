import {
  ChannelPlugin, ChannelPluginContext, IChannelService, ConfigFieldType,
  type MessageContent,
} from 'channel.base';
import { XiaoaiService, XiaoaiAuthMode } from './XiaoaiService';
import type { XiaoaiMessageArgs } from './XiaoaiService';

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveAuthMode(config: Record<string, any>): XiaoaiAuthMode {
  if (config.mode === XiaoaiAuthMode.Password) return XiaoaiAuthMode.Password;
  if (config.mode === XiaoaiAuthMode.PassToken) return XiaoaiAuthMode.PassToken;
  return XiaoaiAuthMode.PassToken;
}

function resolveCredential(config: Record<string, any>): string {
  return readString(config.credential);
}

const HEARTBEAT_MIN_MS = 500;
const HEARTBEAT_DEFAULT_MS = 5000;

function resolveHeartbeat(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= HEARTBEAT_MIN_MS ? n : HEARTBEAT_DEFAULT_MS;
}

export const xiaoaiPlugin: ChannelPlugin = {
  type: 'xiaoai',
  label: '小爱同学',

  configSchema: {
    userId: {
      label: '小米 ID',
      type: ConfigFieldType.String,
      required: true,
      description: '小米账号 ID',
    },
    mode: {
      label: '登录方式',
      type: ConfigFieldType.Select,
      required: true,
      default: 'passToken',
      description: '推荐使用辅助工具导出的 passToken',
      options: [
        { label: 'passToken（推荐）', value: 'passToken' },
        { label: '密码', value: 'password' },
      ],
    },
    credential: {
      label: '密码 / passToken',
      type: ConfigFieldType.Password,
      required: true,
      description: '按登录方式填写小米账号密码或辅助工具导出的 passToken',
    },
    loginDeviceId: {
      label: '登录设备 ID',
      type: ConfigFieldType.String,
      description: 'PassportSDK deviceId，由辅助工具一并导出；留空则随机生成',
    },
    deviceName: {
      label: '音箱名称',
      type: ConfigFieldType.String,
      required: true,
      description: '米家中的小爱音箱名称',
    },
    heartbeat: {
      label: '轮询间隔 (ms)',
      type: ConfigFieldType.Number,
      default: 5000,
      description: '消息轮询间隔毫秒数',
    },
    textChunkLimit: {
      label: 'TTS 分段字数',
      type: ConfigFieldType.Number,
      default: 200,
      description: '超过此字数的回复将被分段播报',
    },
    volume: {
      label: '音量',
      type: ConfigFieldType.Number,
      description: '音箱音量 6-100，留空不设置',
    },
  },

  async init(ctx: ChannelPluginContext): Promise<IChannelService | undefined> {
    const { config, logger, filterEvent, initSession, onReceiveMessage } = ctx;

    const userId = readString(config.userId);
    const mode = resolveAuthMode(config);
    const credential = resolveCredential(config);
    const loginDeviceId = readString(config.loginDeviceId);
    const deviceName = readString(config.deviceName);
    if (!userId || !deviceName || !credential) return undefined;

    const service = new XiaoaiService({
      userId,
      mode,
      credential,
      loginDeviceId,
      deviceName,
      heartbeat: resolveHeartbeat(config.heartbeat),
      textChunkLimit: Number(config.textChunkLimit) || 200,
      volume: config.volume ? Number(config.volume) : undefined,
      logger,
      filterEvent,
      onReceiveMessage: async (args: XiaoaiMessageArgs, query: MessageContent) => {
        const session = await initSession({
          userId: args.accountUserId,
          userName: args.deviceName,
          userInfo: JSON.stringify({
            accountUserId: args.accountUserId,
            deviceId: args.deviceId,
            deviceName: args.deviceName,
          }),
          sessionId: args.sessionId,
          sessionName: `小爱-${args.deviceName}`,
        });
        await onReceiveMessage(session, query, args);
      },
    });

    await service.start();
    return service;
  },
};
