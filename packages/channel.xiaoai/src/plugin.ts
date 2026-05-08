import {
  ChannelPlugin, ChannelPluginContext, IChannelService, ConfigFieldType,
  type MessageContent,
} from 'channel.base';
import { XiaoaiService } from './XiaoaiService';
import type { XiaoaiMessageArgs } from './XiaoaiService';

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
    password: {
      label: '密码',
      type: ConfigFieldType.Password,
      required: true,
      description: '小米账号密码',
    },
    device: {
      label: '设备名称',
      type: ConfigFieldType.String,
      required: true,
      description: '音箱设备名称（需与米家中一致）',
    },
    heartbeat: {
      label: '轮询间隔 (ms)',
      type: ConfigFieldType.Number,
      default: 1000,
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

    const userId = config.userId?.trim();
    const password = config.password?.trim();
    const device = config.device?.trim();
    if (!userId || !password || !device) return undefined;

    const service = new XiaoaiService({
      userId,
      password,
      device,
      heartbeat: Number(config.heartbeat) || 1000,
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
