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
 * - 装饰器自动注册：@singleton(), @transient()
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
   * 使用自定义参数注册单例
   *
   * 与 registerInstance 不同，此方法接受类和构造参数。
   * 参数会根据类型自动匹配到构造函数参数，未匹配的参数会通过容器解析。
   *
   * @example
   * ```ts
   * // 方式 1: 直接使用类 token
   * await container.registerWithArgs(DatabaseService, "localhost", 5432);
   *
   * // 方式 2: 使用接口 token + 实现类
   * await container.registerWithArgs("ILogger", ConsoleLogger, ...args);
   * ```
   */
  async registerWithArgs<T>(token: Constructor<T>, ...args: any[]): Promise<this>;
  async registerWithArgs<T>(token: string | symbol, impl: Constructor<T>, ...args: any[]): Promise<this>;
  async registerWithArgs<T>(token: InjectionToken<T>, ...args: any[]): Promise<this> {
    // 确定实际的实现类
    let actualImpl: Constructor<T>;
    let actualArgs: any[];

    if (typeof token === "function") {
      // 情况 1: token 是类，所有剩余参数都是构造函数参数
      actualImpl = token as Constructor<T>;
      actualArgs = args;
    } else {
      // 情况 2: token 是字符串或 Symbol，第一个参数是实现类，其余是构造函数参数
      if (args.length === 0 || typeof args[0] !== "function") {
        throw new Error(`registerWithArgs: 当使用字符串或 Symbol 作为 token 时，必须提供实现类作为第一个参数`);
      }
      actualImpl = args[0] as Constructor<T>;
      actualArgs = args.slice(1);
    }

    // 使用增强的 constructInstance，传入参数
    const instance = await this.constructInstance(actualImpl, actualArgs.length > 0 ? actualArgs : undefined);

    // 注册为单例
    this.register(token, { useValue: instance }, Lifecycle.Singleton);

    logger.debug(`注册实例（自定义参数）: ${tokenToString(token)}`);
    return this;
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
        `${typeof token === "function" ? "请使用 @singleton() 或 @transient() 装饰器，或手动注册服务。" : "请先使用 container.register() 注册服务。"}`
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
   * @param target 目标类
   * @param providedArgs 可选的预提供参数，会根据类型匹配自动分配
   */
  private async constructInstance<T>(target: Constructor<T>, providedArgs?: any[]): Promise<T> {
    // 获取构造函数参数类型
    const paramTypes = getParamTypes(target);
    const injectTokens = getInjectTokens(target);
    const optionalParams = getOptionalParams(target);

    // 用于跟踪已使用的 providedArgs
    const usedArgIndices = new Set<number>();

    // 解析每个参数
    const args: any[] = [];
    for (let i = 0; i < paramTypes.length; i++) {
      // 优先使用 @inject() 指定的令牌
      const token = injectTokens.get(i) ?? paramTypes[i];
      const isOptional = optionalParams.has(i);
      const hasValidToken = token && token !== Object && token !== undefined;

      // 特殊处理：如果注入的是 Container 本身，返回当前容器实例
      if (hasValidToken && token === Container) {
        args.push(this);
        continue;
      }

      // 尝试从 providedArgs 中找到类型匹配的值
      let foundInProvided = false;
      if (providedArgs && providedArgs.length > 0) {
        // 如果有有效的 token，使用 token 匹配
        // 如果没有有效的 token，尝试按位置匹配（取第一个未使用的参数）
        if (hasValidToken) {
          const matchedValue = this.findMatchingArg(token, providedArgs, usedArgIndices);
          if (matchedValue !== undefined) {
            args.push(matchedValue.value);
            usedArgIndices.add(matchedValue.index);
            foundInProvided = true;
          }
        } else {
          // 没有 token 信息时，按顺序匹配第一个未使用的参数
          for (let j = 0; j < providedArgs.length; j++) {
            if (!usedArgIndices.has(j)) {
              args.push(providedArgs[j]);
              usedArgIndices.add(j);
              foundInProvided = true;
              break;
            }
          }
        }
      }

      // 如果在 providedArgs 中找到了，跳过容器解析
      if (foundInProvided) {
        continue;
      }

      // 如果没有有效的 token 且没有在 providedArgs 中找到
      if (!hasValidToken) {
        if (isOptional) {
          args.push(undefined);
          continue;
        }
        throw new Error(
          `无法解析 ${target.name} 的第 ${i} 个构造函数参数。` +
          `请使用 @inject() 装饰器指定注入令牌，或确保参数类型是可注入的类，` +
          `或在调用 registerWithArgs 时提供该参数的值。`
        );
      }

      // 通过容器解析
      if (isOptional) {
        // 可选依赖：解析失败时注入 undefined（包括依赖链上的失败）
        try {
          if (!this.isRegistered(token)) {
            args.push(undefined);
          } else {
            args.push(await this.resolve(token));
          }
        } catch {
          args.push(undefined);
        }
      } else {
        args.push(await this.resolve(token));
      }
    }

    return new target(...args);
  }

  /**
   * 在提供的参数中查找类型匹配的值
   * @param token 需要匹配的 token
   * @param providedArgs 提供的参数列表
   * @param usedIndices 已使用的参数索引
   * @returns 匹配的值和索引，如果没找到返回 undefined
   */
  private findMatchingArg(
    token: InjectionToken,
    providedArgs: any[],
    usedIndices: Set<number>
  ): { value: any; index: number } | undefined {
    for (let i = 0; i < providedArgs.length; i++) {
      // 跳过已使用的参数
      if (usedIndices.has(i)) continue;

      const arg = providedArgs[i];

      // 1. 如果 token 是类，检查实例类型
      if (typeof token === "function" && token.prototype) {
        if (arg instanceof token) {
          return { value: arg, index: i };
        }
        // 也检查构造函数
        if (arg?.constructor === token) {
          return { value: arg, index: i };
        }
      }

      // 2. 如果 token 是 Symbol，检查 Symbol 类型
      if (typeof token === "symbol" && typeof arg === "symbol") {
        if (token === arg) {
          return { value: arg, index: i };
        }
      }

      // 3. 如果 token 是字符串，检查字符串类型
      if (typeof token === "string" && typeof arg === "string") {
        // 字符串匹配比较宽松：只要类型相同即可
        // （因为字符串 token 通常用于配置值）
        return { value: arg, index: i };
      }

      // 4. 基本类型匹配
      if (token === String && typeof arg === "string") {
        return { value: arg, index: i };
      }
      if (token === Number && typeof arg === "number") {
        return { value: arg, index: i };
      }
      if (token === Boolean && typeof arg === "boolean") {
        return { value: arg, index: i };
      }
    }

    return undefined;
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
