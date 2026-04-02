import { AskResponse, AskToolParams, AskQuestionType } from "scorpio.ai";
import { ChannelSessionHandler } from "./ChannelSessionHandler";
import { SessionService } from "./SessionService";

export interface ActionResult {
  /** Arbitrary data returned to the frontend (e.g. qrcodeUrl, status). */
  [key: string]: any;
  /** If present, the frontend auto-fills these values into the config form and persists them. */
  configUpdates?: Record<string, any>;
}

export interface IChannelService {
  createUserService(session: SessionService): ChannelSessionHandler;
  /** Generic action handler dispatched by HttpServer. Channel plugins implement this to handle configSchema actions. */
  executeAction?(action: string, params?: any): Promise<ActionResult>;
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
  /** Renders a button that triggers a channel action via API. */
  Action = 'action',
}

/** How to display the result of a configSchema action. */
export enum ActionResultType {
  /** Show a QR image and auto-poll `${key}-status` until confirmed/expired. */
  QR = 'qr',
}

export interface ConfigField {
  label: string;
  type: ConfigFieldType;
  required?: boolean;
  description?: string;
  default?: string | boolean | number;
  /** only for type: 'select' */
  options?: Array<{ label: string; value: string }>;
  /**
   * Only for type: 'action'.
   * How to display the action result. The configSchema key is used as the action name.
   * For 'qr', the frontend auto-polls `${key}-status` until confirmed/expired.
   */
  actionResultType?: ActionResultType;
}

export interface ChannelPlugin {
  type: string;
  configSchema?: Record<string, ConfigField>;
  init(ctx: ChannelPluginContext): Promise<IChannelService | undefined>;
  dispose?(): Promise<void>;
}
