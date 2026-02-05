import { EventBus } from "./EventBus";
import { AgentMessage } from "../Agent/AgentService";

/**
 * 插件元数据
 */
export interface PluginMetadata {
  name: string;              // 插件名称（唯一标识）
  version: string;           // 版本号
  description?: string;      // 插件描述
  author?: string;           // 作者
  homepage?: string;         // 主页
  dependencies?: string[];   // 依赖的其他插件
}

/**
 * 插件配置
 */
export interface PluginConfig {
  enabled?: boolean;         // 是否启用
  priority?: number;         // 优先级（数字越小越先执行）
  config?: Record<string, any>; // 插件特定配置
}

/**
 * 插件上下文
 * 提供给插件的运行环境
 */
export interface PluginContext {
  eventBus: EventBus;        // 事件总线
  config: Record<string, any>; // 插件配置
  logger: any;               // 日志服务
  getPlugin?: (name: string) => IPlugin | undefined; // 获取其他插件
}

/**
 * 插件接口
 * 所有插件都必须实现此接口
 */
export interface IPlugin {
  /**
   * 插件元数据
   */
  readonly metadata: PluginMetadata;

  /**
   * 插件是否已加载
   */
  isLoaded?: boolean;

  /**
   * 加载插件
   * 在插件被加载时调用，用于初始化资源
   */
  onLoad?(context: PluginContext): Promise<void>;

  /**
   * 卸载插件
   * 在插件被卸载时调用，用于清理资源
   */
  onUnload?(): Promise<void>;

  /**
   * 查询前钩子
   * 在用户查询发送给 AI 之前调用
   * @param query 用户查询
   * @returns 修改后的查询（如果不需要修改返回原查询）
   */
  onBeforeQuery?(query: string, context: any): Promise<string>;

  /**
   * 查询后钩子
   * 在 AI 响应生成之后调用
   * @param response AI 响应
   * @param query 原始查询
   * @returns 修改后的响应（如果不需要修改返回原响应）
   */
  onAfterResponse?(response: string, query: string, context: any): Promise<string>;

  /**
   * 消息钩子
   * 在每条消息处理时调用
   */
  onMessage?(message: AgentMessage, context: any): Promise<AgentMessage>;

  /**
   * 工具调用前钩子
   * 在工具被调用之前
   */
  onBeforeToolCall?(toolName: string, args: any, context: any): Promise<void>;

  /**
   * 工具调用后钩子
   * 在工具调用完成之后
   */
  onAfterToolCall?(toolName: string, result: any, context: any): Promise<void>;

  /**
   * 错误处理钩子
   * 当发生错误时调用
   */
  onError?(error: Error, context: any): Promise<void>;
}

/**
 * 插件基类
 * 提供默认实现，插件可以继承此类
 */
export abstract class BasePlugin implements IPlugin {
  abstract metadata: PluginMetadata;

  isLoaded = false;
  protected context?: PluginContext;

  async onLoad(context: PluginContext): Promise<void> {
    this.context = context;
    this.isLoaded = true;
    this.context.logger.info(`插件 ${this.metadata.name} 已加载`);
  }

  async onUnload(): Promise<void> {
    this.isLoaded = false;
    this.context?.logger.info(`插件 ${this.metadata.name} 已卸载`);
  }

  /**
   * 发送事件
   */
  protected emit(event: string, data?: any): void {
    this.context?.eventBus.emit(event, data);
  }

  /**
   * 监听事件
   */
  protected on(event: string, handler: (data: any) => void | Promise<void>): () => void {
    if (!this.context) {
      throw new Error("插件上下文未初始化");
    }
    return this.context.eventBus.on(event, handler);
  }

  /**
   * 获取配置
   */
  protected getConfig<T = any>(key: string, defaultValue?: T): T {
    return this.context?.config[key] ?? defaultValue;
  }
}

/**
 * 插件钩子类型
 */
export type PluginHookType =
  | "onLoad"
  | "onUnload"
  | "onBeforeQuery"
  | "onAfterResponse"
  | "onMessage"
  | "onBeforeToolCall"
  | "onAfterToolCall"
  | "onError";

/**
 * 插件钩子执行结果
 */
export interface HookResult<T = any> {
  success: boolean;
  data?: T;
  error?: Error;
  pluginName: string;
}
