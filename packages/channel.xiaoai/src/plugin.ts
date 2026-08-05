import {
  defineChannelPlugin, ChannelPluginContext, IChannelService, ConfigFieldType,
  type MessageContent,
} from 'channel.base';
import { XiaoaiAuthMode } from './XiaoaiAPI';
import { XiaoaiService } from './XiaoaiService';
import type { XiaoaiMessageArgs } from './XiaoaiService';

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** 一行一项的多值字段；单值老配置在此天然兼容（split 后长度为 1）。 */
function readLines(value: unknown): string[] {
  const items = readString(value)
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set(items)];
}

const XIAOAI_CHANNEL_PROMPT = `<channel-info name="xiaoai">
你的输出会被 TTS 朗读出来，不是显示在屏幕上：
- 用口语化的句子，避免任何 markdown 语法（*粗体*、\`代码\`、列表项符号、# 标题等会被字面读出）。
- 不要给链接、文件路径、长串 ID，这些念出来没意义。
- 不要使用代码块，长内容请用自然语言概括。
- 控制长度，音箱朗读超过几句话用户会听不下去。
</channel-info>`;

export const xiaoaiPlugin = defineChannelPlugin({
  type: 'xiaoai',
  label: '小爱同学',
  channelPrompt: XIAOAI_CHANNEL_PROMPT,

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
      description: '推荐使用 sbox 导出的 passToken，下载：https://github.com/while-coder/sbox/releases',
      options: [
        { label: 'passToken（推荐）', value: XiaoaiAuthMode.PassToken },
        { label: '密码', value: XiaoaiAuthMode.Password },
      ],
    },
    credential: {
      label: '密码 / passToken',
      type: ConfigFieldType.Password,
      required: true,
      description: '按登录方式填写小米账号密码，或用 sbox 导出的 passToken',
    },
    loginDeviceId: {
      label: '登录设备 ID',
      type: ConfigFieldType.String,
      description: 'PassportSDK deviceId，由 sbox 一并导出；留空则随机生成',
    },
    deviceNames: {
      label: '音箱名称',
      type: ConfigFieldType.Textarea,
      required: true,
      description: '米家中的小爱音箱名称或别名；同名音箱多台时可填 deviceID 精确指定。'
        + '一行一台，可同时接入多台音箱，每台音箱是各自独立的会话',
    },
    heartbeat: {
      label: '轮询间隔 (ms)',
      type: ConfigFieldType.Number,
      default: 5000,
      description: '每台音箱各自的消息轮询间隔毫秒数；接入多台时建议适当调大',
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
    // deviceName 是改名前的旧字段，保留读取以兼容既有渠道配置
    const deviceNames = readLines(config.deviceNames ?? config.deviceName);
    const heartbeat = Number(config.heartbeat);
    if (!userId || deviceNames.length === 0 || !credential) return undefined;

    const service = new XiaoaiService({
      userId,
      authMode,
      credential,
      loginDeviceId,
      deviceNames,
      heartbeat: Number.isFinite(heartbeat) && heartbeat >= 500 ? heartbeat : 5000,
      textChunkLimit: Number(config.textChunkLimit) || 200,
      volume: config.volume ? Number(config.volume) : undefined,
      logger,
      filterEvent,
      onReceiveMessage: async (args: XiaoaiMessageArgs, query: MessageContent) => {
        const session = await initSession({
          userId: args.accountUserId,
          // 账号维度：全部音箱共用一行 channel_user，用小米 ID 避免被各音箱名反复覆盖。
          // 音箱名由 sessionName 承载（LLM 与日志看到的都是它）
          userName: args.accountUserId,
          userInfo: JSON.stringify({
            accountUserId: args.accountUserId,
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
});
