import { AskResponse, AskToolParams, AskQuestionType } from "scorpio.ai";
import { ChannelSessionHandler } from "./ChannelSessionHandler";
import { SessionService } from "./SessionService";

export interface IChannelService {
  createUserService(session: SessionService): ChannelSessionHandler;
  dispose?(): void;
}

export interface InitSessionContext {
  userId: string;
  userName: string;
  userInfo: string;
  userAvatar?: string;
  sessionId: string;
  sessionName: string;
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
  onReceiveMessage: (session: ChannelSessionInfo, query: string, args: ChannelMessageArgs) => Promise<void>;
  onTriggerAction: (session: ChannelSessionInfo, args: any) => Promise<void>;
}

export interface ChannelToolHelpers {
  createAskTool: (
    channelType: string,
    askFn: (params: AskToolParams) => Promise<AskResponse>,
    supportedTypes?: AskQuestionType[],
  ) => any;
  createSendFileTool: (
    channelType: string,
    sendFileFn: (filePath: string, fileName: string) => Promise<void>,
  ) => any;
}

export type ProcessAIHandler = (
  query: string,
  args: ChannelMessageArgs,
  userService: ChannelSessionHandler,
) => Promise<void>;

export enum ConfigFieldType {
  String = 'string',
  Boolean = 'boolean',
  Number = 'number',
  Select = 'select',
}

export interface ConfigField {
  label: string;
  type: `${ConfigFieldType}`;
  required?: boolean;
  description?: string;
  default?: string | boolean | number;
  /** only for type: 'select' */
  options?: Array<{ label: string; value: string }>;
}

export interface ChannelPlugin {
  type: string;
  configSchema?: Record<string, ConfigField>;
  init(ctx: ChannelPluginContext): Promise<IChannelService | undefined>;
  dispose?(): Promise<void>;
}
