import "reflect-metadata";
import {
  InjectionToken,
  Constructor,
  Lifecycle,
  Provider,
  Registration,
  isClassProvider,
  isFactoryProvider,
  isValueProvider,
} from "./types";
import {
  isInjectable,
  getLifecycle,
  getInjectTokens,
  getParamTypes,
  getInitMethod,
  getDisposeMethod,
  getOptionalParams,
} from "./decorators";
import { LoggerService } from "../LoggerService";

const logger = LoggerService.getLogger("Container");

/**
 * 将 InjectionToken 转为可读字符串（用于日志和错误信息）
 */
function tokenToString(token: InjectionToken): string {
  if (typeof token === "string") return `"${token}"`;
  if (typeof token === "symbol") return token.toString();
  return token.name || token.toString();
}

/**
 * 依赖注入容器
 *
 * 参考 tsyringe 设计，提供简洁的 API：
 * - 装饰器自动注册：@singleton(), @injectable()
 * - 类型安全的解析：container.resolve(MyService)
 * - 支持多种注册方式：类、工厂、值
 *
 * @example
 * ```ts
 * // 1. 使用装饰器（推荐）
 * @singleton()
 * class DatabaseService {
 *   @init()
 *   async connect() { ... }
 * }
 *
 * // 2. 手动注册
 * container.register("API_KEY", { useValue: "xxx" });
 *
 * // 3. 解析
 * const db = await container.resolve(DatabaseService);
 * ```
 */
export class Container {
  private registrations = new Map<InjectionToken, Registration>();
  private resolutionStack = new Set<InjectionToken>(); // 循环依赖检测
  private disposables: Array<{ instance: any; method: string | symbol }> = [];

  /**
   * 注册服务
   *
   * @param token 注入令牌（类、字符串或 Symbol）
   * @param provider 服务提供者
   * @param lifecycle 生命周期（默认 Transient）
   *
   * @example
   * ```ts
   * // 注册类
   * container.register(ILogger, { useClass: ConsoleLogger });
   *
   * // 注册工厂
   * container.register("DB", { useFactory: (c) => new Database(c.resolve(Config)) });
   *
   * // 注册值
   * container.register("API_KEY", { useValue: "my-secret-key" });
   * ```
   */
  register<T>(token: InjectionToken<T>, provider: Provider<T>, lifecycle?: Lifecycle): this {
    const resolvedLifecycle = lifecycle ?? (isValueProvider(provider) ? Lifecycle.Singleton : Lifecycle.Transient);

    this.registrations.set(token, {
      token,
      provider,
      lifecycle: resolvedLifecycle,
    });

    logger.debug(`注册服务: ${tokenToString(token)} (${resolvedLifecycle})`);
    return this;
  }

  /**
   * 注册单例服务
   *
   * @example
   * ```ts
   * container.registerSingleton(DatabaseService);
   * container.registerSingleton("ILogger", ConsoleLogger);
   * ```
   */
  registerSingleton<T>(token: InjectionToken<T>, impl?: Constructor<T>): this {
    if (impl) {
      return this.register(token, { useClass: impl }, Lifecycle.Singleton);
    }
    // token 本身就是类
    if (typeof token === "function") {
      return this.register(token, { useClass: token as Constructor<T> }, Lifecycle.Singleton);
    }
    throw new Error(`registerSingleton: 必须提供实现类`);
  }

  /**
   * 注册实例（直接注册一个已有的值作为单例）
   *
   * @example
   * ```ts
   * const config = new Config();
   * container.registerInstance(Config, config);
   * container.registerInstance("API_KEY", "my-key");
   * ```
   */
  registerInstance<T>(token: InjectionToken<T>, instance: T): this {
    return this.register(token, { useValue: instance }, Lifecycle.Singleton);
  }

  /**
   * 解析服务
   *
   * @param token 注入令牌
   * @returns 服务实例
   *
   * @example
   * ```ts
   * const db = await container.resolve(DatabaseService);
   * const key = await container.resolve<string>("API_KEY");
   * ```
   */
  async resolve<T>(token: InjectionToken<T>): Promise<T> {
    // 1. 循环依赖检测
    if (this.resolutionStack.has(token)) {
      const chain = [...this.resolutionStack].map(tokenToString).join(" -> ");
      throw new Error(`检测到循环依赖: ${chain} -> ${tokenToString(token)}`);
    }

    // 2. 查找注册信息
    let registration = this.registrations.get(token);

    // 3. 如果没有注册，且是带装饰器的类，则自动注册
    if (!registration && typeof token === "function") {
      if (isInjectable(token)) {
        const lifecycle = getLifecycle(token) ?? Lifecycle.Transient;
        this.register(token, { useClass: token as Constructor<T> }, lifecycle);
        registration = this.registrations.get(token);
        logger.debug(`自动注册装饰器类: ${tokenToString(token)} (${lifecycle})`);
      }
    }

    if (!registration) {
      throw new Error(
        `服务未注册: ${tokenToString(token)}。` +
        `${typeof token === "function" ? "请使用 @singleton() 或 @injectable() 装饰器，或手动注册服务。" : "请先使用 container.register() 注册服务。"}`
      );
    }

    // 4. 单例：返回缓存实例
    if (registration.lifecycle === Lifecycle.Singleton && registration.instance !== undefined) {
      return registration.instance as T;
    }

    // 5. 创建实例
    this.resolutionStack.add(token);
    try {
      const instance = await this.createInstance<T>(registration);

      // 6. 单例缓存
      if (registration.lifecycle === Lifecycle.Singleton) {
        registration.instance = instance;
      }

      return instance;
    } finally {
      this.resolutionStack.delete(token);
    }
  }

  /**
   * 尝试解析服务（不抛出异常）
   */
  async tryResolve<T>(token: InjectionToken<T>): Promise<T | null> {
    try {
      return await this.resolve<T>(token);
    } catch {
      return null;
    }
  }

  /**
   * 检查服务是否已注册（包括可以自动注册的装饰器类）
   */
  isRegistered<T>(token: InjectionToken<T>): boolean {
    if (this.registrations.has(token)) return true;
    // 检查是否是带装饰器的类（可以自动注册）
    if (typeof token === "function" && isInjectable(token)) return true;
    return false;
  }

  /**
   * 重置容器（清除所有注册和实例）
   */
  reset(): void {
    this.registrations.clear();
    this.disposables = [];
    logger.debug("容器已重置");
  }

  /**
   * 销毁容器，调用所有单例的 dispose 方法
   */
  async dispose(): Promise<void> {
    logger.info("正在销毁容器...");

    // 调用所有标记了 @dispose() 的方法
    for (const { instance, method } of this.disposables) {
      try {
        await instance[method]();
        logger.debug(`已销毁: ${instance.constructor?.name || "unknown"}`);
      } catch (error: any) {
        logger.error(`销毁服务失败: ${error.message}`);
      }
    }

    this.disposables = [];

    // 清除所有单例实例
    for (const registration of this.registrations.values()) {
      registration.instance = undefined;
    }

    logger.info("容器已销毁");
  }

  /**
   * 获取所有已注册的令牌
   */
  getRegisteredTokens(): InjectionToken[] {
    return Array.from(this.registrations.keys());
  }

  /**
   * 创建实例
   */
  private async createInstance<T>(registration: Registration): Promise<T> {
    const { provider } = registration;

    let instance: T;

    if (isValueProvider(provider)) {
      // 值提供者：直接返回
      return provider.useValue as T;
    } else if (isFactoryProvider(provider)) {
      // 工厂提供者：调用工厂函数
      instance = await provider.useFactory(this) as T;
    } else if (isClassProvider(provider)) {
      // 类提供者：解析构造函数依赖并实例化
      instance = await this.constructInstance<T>(provider.useClass);
    } else {
      throw new Error(`未知的 Provider 类型`);
    }

    // 调用 @init() 标记的初始化方法
    await this.callInitMethod(instance);

    // 记录 @dispose() 标记的销毁方法
    this.trackDisposable(instance);

    return instance;
  }

  /**
   * 通过构造函数创建实例，自动解析依赖
   */
  private async constructInstance<T>(target: Constructor<T>): Promise<T> {
    // 获取构造函数参数类型
    const paramTypes = getParamTypes(target);
    const injectTokens = getInjectTokens(target);
    const optionalParams = getOptionalParams(target);

    // 解析每个参数
    const args: any[] = [];
    for (let i = 0; i < paramTypes.length; i++) {
      // 优先使用 @inject() 指定的令牌
      const token = injectTokens.get(i) ?? paramTypes[i];
      const isOptional = optionalParams.has(i);

      if (!token || token === Object || token === undefined) {
        if (isOptional) {
          args.push(undefined);
          continue;
        }
        throw new Error(
          `无法解析 ${target.name} 的第 ${i} 个构造函数参数。` +
          `请使用 @inject() 装饰器指定注入令牌，或确保参数类型是可注入的类。`
        );
      }

      // 特殊处理：如果注入的是 Container 本身，返回当前容器实例
      if (token === Container) {
        args.push(this);
      } else if (isOptional && !this.isRegistered(token)) {
        args.push(undefined);
      } else {
        args.push(await this.resolve(token));
      }
    }

    return new target(...args);
  }

  /**
   * 调用 @init() 标记的方法
   */
  private async callInitMethod(instance: any): Promise<void> {
    if (!instance || !instance.constructor) return;

    const initMethod = getInitMethod(instance.constructor);
    if (initMethod && typeof instance[initMethod] === "function") {
      logger.debug(`调用初始化方法: ${instance.constructor.name}.${String(initMethod)}()`);
      await instance[initMethod]();
    }
  }

  /**
   * 记录需要销毁的实例
   */
  private trackDisposable(instance: any): void {
    if (!instance || !instance.constructor) return;

    const disposeMethod = getDisposeMethod(instance.constructor);
    if (disposeMethod && typeof instance[disposeMethod] === "function") {
      this.disposables.push({ instance, method: disposeMethod });
    }
  }

  /**
   * 打印容器信息（调试用）
   */
  debug(): void {
    console.log(`\n=== 依赖注入容器 ===`);
    console.log(`已注册服务 (${this.registrations.size}):`);

    for (const [token, reg] of this.registrations.entries()) {
      const name = tokenToString(token);
      const hasInstance = reg.instance !== undefined ? " ✓" : "";
      const providerType = isClassProvider(reg.provider)
        ? `class:${reg.provider.useClass.name}`
        : isFactoryProvider(reg.provider)
        ? "factory"
        : "value";
      console.log(`  ${name} [${reg.lifecycle}] (${providerType})${hasInstance}`);
    }

    console.log(`\n可销毁实例 (${this.disposables.length}):`);
    for (const { instance } of this.disposables) {
      console.log(`  • ${instance.constructor?.name || "unknown"}`);
    }
    console.log(`========================\n`);
  }
}

/**
 * 全局容器实例
 */
export const globalContainer = new Container();
