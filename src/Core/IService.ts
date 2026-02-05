/**
 * 服务基础接口
 * 所有可挂载的服务都应实现此接口
 */
export interface IService {
  /**
   * 服务名称（唯一标识）
   */
  readonly serviceName: string;

  /**
   * 初始化服务
   * 在服务首次使用时调用
   */
  initialize?(): Promise<void>;

  /**
   * 释放服务资源
   * 在服务销毁时调用
   */
  dispose?(): Promise<void>;

  /**
   * 服务是否已初始化
   */
  isInitialized?: boolean;
}

/**
 * 服务生命周期
 */
export enum ServiceLifetime {
  /**
   * 单例：整个应用程序生命周期内只创建一次
   */
  SINGLETON = "singleton",

  /**
   * 作用域：每个作用域（如每个用户会话）创建一次
   */
  SCOPED = "scoped",

  /**
   * 瞬时：每次请求都创建新实例
   */
  TRANSIENT = "transient"
}

/**
 * 服务配置
 */
export interface ServiceConfiguration {
  enabled?: boolean;           // 是否启用
  config?: Record<string, any>; // 服务配置
  dependencies?: string[];     // 依赖的其他服务
}

/**
 * 服务描述符
 */
export interface ServiceDescriptor<T extends IService = IService> {
  /**
   * 服务接口名称（用于注册和获取）
   */
  name: string;

  /**
   * 服务实现类
   */
  implementation: new (...args: any[]) => T;

  /**
   * 服务生命周期
   */
  lifetime: ServiceLifetime;

  /**
   * 服务配置
   */
  configuration?: ServiceConfiguration;

  /**
   * 工厂函数（可选，用于复杂的服务创建）
   */
  factory?: (container: any) => T | Promise<T>;
}
