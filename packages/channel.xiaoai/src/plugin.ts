import {
  ChannelPlugin, ChannelPluginContext, IChannelService, ConfigFieldType,
  type MessageContent,
} from 'channel.base';
import { XiaoaiAuthMode } from './XiaoaiAPI';
import { XiaoaiService } from './XiaoaiService';
import type { XiaoaiMessageArgs } from './XiaoaiService';

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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
      default: XiaoaiAuthMode.PassToken,
      description: '推荐使用辅助工具导出的 passToken',
      options: [
        { label: 'passToken（推荐）', value: XiaoaiAuthMode.PassToken },
        { label: '密码', value: XiaoaiAuthMode.Password },
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
    const authMode = config.mode === XiaoaiAuthMode.Password ? XiaoaiAuthMode.Password : XiaoaiAuthMode.PassToken;
    const credential = readString(config.credential);
    const loginDeviceId = readString(config.loginDeviceId);
    const deviceName = readString(config.deviceName);
    const heartbeat = Number(config.heartbeat);
    if (!userId || !deviceName || !credential) return undefined;

    const service = new XiaoaiService({
      userId,
      authMode,
      credential,
      loginDeviceId,
      deviceName,
      heartbeat: Number.isFinite(heartbeat) && heartbeat >= 500 ? heartbeat : 5000,
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
