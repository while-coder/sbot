import { type MessageContent } from "scorpio.ai";
import { ChannelSessionHandler } from "./ChannelSessionHandler";
import { SessionService } from "./SessionService";

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
  userName: string;
  userInfo: string;
  userAvatar?: string;
  sessionId: string;
  sessionName?: string;
  sessionAvatar?: string;
  sendUpdate?: (msg: string) => Promise<void>;
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
  onReceiveMessage: (session: ChannelSessionInfo, query: MessageContent, args: ChannelMessageArgs) => Promise<void>;
  onTriggerAction: (session: ChannelSessionInfo, args: any) => Promise<void>;
}

export type ProcessAIHandler = (
  query: MessageContent,
  args: ChannelMessageArgs,
  sessionHandler: ChannelSessionHandler,
) => Promise<void>;

export enum ConfigFieldType {
  String = 'string',
  Password = 'password',
  Boolean = 'boolean',
  Number = 'number',
  Select = 'select',
  /** Renders a button → QR code image → waits for scan result. */
  QRCode = 'qrcode',
}

export interface ConfigField {
  label: string;
  type: ConfigFieldType;
  required?: boolean;
  description?: string;
  default?: string | boolean | number;
  /** only for type: 'select' */
  options?: Array<{ label: string; value: string }>;
}

export interface ChannelPlugin {
  type: string;
  label: string;
  configSchema: Record<string, ConfigField>;
  /** 该频道类型支持的工具列表（供 admin 配置白名单） */
  tools?: { name: string; label: string }[];
  /** Get a QR code for the given config key. Returns url and display type. */
  getQRCode?(key: string, params?: any): Promise<{ url: string; type: 'image' | 'link' }>;
  /** Long-poll until QR scan completes for the given config key. Returns credentials object, or null if expired. */
  awaitQRResult?(key: string): Promise<Record<string, any> | null>;
  init(ctx: ChannelPluginContext): Promise<IChannelService | undefined>;
  dispose?(): Promise<void>;
}
