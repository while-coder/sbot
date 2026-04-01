import { AskResponse, AskToolParams, AskQuestionType } from "scorpio.ai";
import { ChannelSessionHandler } from "./ChannelSessionHandler";
import { SessionService } from "./SessionService";

export interface IChannelService {
  dispose?(): void;
}

export interface ReceiveMessageContext {
  channelId: string;
  userId: string;
  userName: string;
  userInfo: string;
  sessionId: string;
  sessionName: string;
  processMessage: (dbSessionId: number) => Promise<void>;
  sendUpdate: (msg: string) => Promise<void>;
  userAvatar?: string;
  sessionAvatar?: string;
}

export interface ChannelPluginContext {
  channelId: string;
  config: Record<string, any>;
  logger: any;
  filterEvent: (eventId: string) => Promise<boolean>;
  handleReceiveMessage: (ctx: ReceiveMessageContext) => Promise<void>;
  onReceiveMessage: (query: string, threadId: string, args: any) => Promise<void>;
  onTriggerAction: (threadId: string, args: any) => Promise<void>;
}

export interface AgentToolHelpers {
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
  args: any,
  userService: ChannelSessionHandler,
) => Promise<void>;

export interface ChannelPlugin {
  type: string;
  init(ctx: ChannelPluginContext): Promise<IChannelService | undefined>;
  createUserService(session: SessionService): ChannelSessionHandler;
  dispose?(): Promise<void>;
}
