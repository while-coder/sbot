import { type MessageContent } from "scorpio.ai";
import { ConfigField, ConfigFieldType } from "sbot.plugin";
import { ChannelSessionHandler } from "./ChannelSessionHandler";
import { SessionService } from "./SessionService";

export { ConfigField, ConfigFieldType };

/** Capability tokens advertised by a running IChannelService instance. Mirrors which optional send methods are implemented. */
export enum ChannelCapability {
  Text     = 'text',
  File     = 'file',
  TextUser = 'text_user',
  FileUser = 'file_user',
}

export interface IChannelService {
  createSessionHandler(session: SessionService): ChannelSessionHandler;
  /**
   * All four send methods are optional. Implement only what the underlying platform
   * actually supports — leave the rest off so callers (e.g. channel_list_data, Tools)
   * can advertise real capabilities and avoid silent no-ops.
   * `userId` in *ToUser variants is the channel-native id (e.g. open_id, qq, userid).
   */
  sendTextToSession?(sessionId: string, text: string): Promise<void>;
  sendFileToSession?(sessionId: string, file: string | Buffer, fileName?: string): Promise<void>;
  sendTextToUser?(userId: string, text: string): Promise<void>;
  sendFileToUser?(userId: string, file: string | Buffer, fileName?: string): Promise<void>;
  dispose(): void;
}

export interface InitSessionContext {
  userId: string;
  /** Optional channel-native open id when the platform distinguishes it from userId. */
  userOpenId?: string;
  userName: string;
  userInfo: string;
  userAvatar?: string;
  sessionId: string;
  sessionName?: string;
  sessionAvatar?: string;
  sendUpdate?: (msg: string) => Promise<void>;
  /** 渠道私有会话状态，持久化到 channel_session.metadata（JSON）。重启后可经 loadSessions 取回。 */
  metadata?: Record<string, any>;
}

export interface ChannelSessionInfo {
  channelId: string;
  userId: string;
  sessionId: string;
  dbUserId: number;
  dbSessionId: number;
}

/** Base interface for channel message args. All channel-specific args must extend this. */
export interface ChannelMessageArgs {
  /** Channel-agnostic session identifier (same value stored in DB channelSession.sessionId). */
  sessionId: string;
  /** Channel-specific extra info (e.g. user metadata) passed to the AI agent. */
  extraInfo?: string;
  [key: string]: any;
}

export interface ChannelPluginContext {
  config: Record<string, any>;
  logger: any;
  filterEvent: (eventId: string) => Promise<boolean>;
  initSession: (ctx: InitSessionContext) => Promise<ChannelSessionInfo>;
  /** 读取本 channel 已持久化的会话 metadata（sessionId → metadata），用于 init 时重建内存会话态。 */
  loadSessionMetadata: () => Promise<Record<string, Record<string, any>>>;
  onReceiveMessage: (session: ChannelSessionInfo, query: MessageContent, args: ChannelMessageArgs) => Promise<void>;
  onTriggerAction: (session: ChannelSessionInfo, args: any) => Promise<void>;
}

export type ProcessAIHandler = (
  query: MessageContent,
  args: ChannelMessageArgs,
  sessionHandler: ChannelSessionHandler,
) => Promise<void>;

export interface ChannelPlugin {
  /** 区分插件种类，供统一加载器分流（与 WikiPlugin 的 kind:'wiki' 区别开）。 */
  kind: "channel";
  type: string;
  label: string;
  configSchema: Record<string, ConfigField>;
  /** 该频道类型支持的工具列表（供 admin 配置白名单） */
  tools?: { name: string; label: string }[];
  /**
   * Channel 维度的静态 prompt（输出介质/格式硬约束）。
   * 由 plugin 作为常量声明，每条消息相同，会被注入到 AgentRunner 的可缓存 extraPrompts。
   */
  channelPrompt?: string;
  /** Get a QR code for the given config key. Returns url and display type. */
  getQRCode?(key: string, params?: any): Promise<{ url: string; type: 'image' | 'link' }>;
  /** Long-poll until QR scan completes for the given config key. Returns credentials object, or null if expired. */
  awaitQRResult?(key: string): Promise<Record<string, any> | null>;
  init(ctx: ChannelPluginContext): Promise<IChannelService | undefined>;
  dispose?(): Promise<void>;
}

/**
 * 声明一个 channel 插件。自动注入 `kind: "channel"`，各插件无需手写判别字段。
 * 类型上要求除 kind 外的所有字段，漏写/拼错照常报错。
 */
export function defineChannelPlugin(plugin: Omit<ChannelPlugin, "kind">): ChannelPlugin {
  return { ...plugin, kind: "channel" };
}
