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
export class ServiceContainer {
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
   * 使用命名参数注册服务
   *
   * 与 registerInstance 不同，此方法接受类和命名参数对象。
   * 参数通过 @inject("key") 装饰器的 key 进行匹配，未匹配的参数会通过容器解析。
   *
   * 支持的 key 类型：
   * - 字符串: @inject("key") → { key: value }
   * - Symbol: @inject(MySymbol) → { [MySymbol]: value }
   * - 类/函数: @inject(IService) → { [IService as any]: value }
   *
   * 注意：
   * - 此方法只支持命名参数模式（对象），不支持位置参数
   * - 实例在首次 resolve 时才会创建（延迟创建）
   * - 默认生命周期为 Singleton
   * - 使用类作为 key 时需要使用 `as any` 进行类型断言
   *
   * @param token 注入令牌（类或字符串/Symbol）
   * @param implOrArgsOrLifecycle 实现类、命名参数对象或生命周期
   * @param argsOrLifecycle 命名参数对象或生命周期
   * @param args 命名参数对象
   *
   * @example
   * ```ts
   * // 方式 1: 字符串 key（推荐）
   * container.registerWithArgs(DatabaseService, {
   *   host: "localhost",
   *   port: 5432
   * });
   *
   * // 方式 2: Symbol key
   * const ILogger = Symbol("ILogger");
   * container.registerWithArgs(MyService, {
   *   [ILogger]: loggerInstance
   * });
   *
   * // 方式 3: 类作为 key（需要 as any）
   * container.registerWithArgs(MemoryCompressor, {
   *   [IModelService as any]: modelInstance,
   *   threshold: 0.8
   * });
   *
   * // 方式 4: 使用接口 token + 实现类
   * container.registerWithArgs(IAgentSaverService, AgentSqliteSaver, {
   *   SavePath: "11111"
   * });
   * ```
   */
  registerWithArgs<T>(token: Constructor<T>, args?: Record<string | symbol, any>): this;
  registerWithArgs<T>(token: Constructor<T>, lifecycle: Lifecycle, args?: Record<string | symbol, any>): this;
  registerWithArgs<T>(token: string | symbol, impl: Constructor<T>, args?: Record<string | symbol, any>): this;
  registerWithArgs<T>(token: string | symbol, impl: Constructor<T>, lifecycle: Lifecycle, args?: Record<string | symbol, any>): this;
  registerWithArgs<T>(
    token: InjectionToken<T>,
    implOrArgsOrLifecycle?: Constructor<T> | Record<string | symbol, any> | Lifecycle,
    argsOrLifecycle?: Record<string | symbol, any> | Lifecycle,
    args?: Record<string | symbol, any>
  ): this {
    let actualImpl: Constructor<T>;
    let namedArgs: Record<string | symbol, any> | undefined = undefined;
    let lifecycle: Lifecycle = Lifecycle.Singleton;

    if (typeof token === "function") {
      // 情况 1: token 是类
      actualImpl = token as Constructor<T>;

      // 解析参数
      if (implOrArgsOrLifecycle !== undefined) {
        if (typeof implOrArgsOrLifecycle === "string" && Object.values(Lifecycle).includes(implOrArgsOrLifecycle as Lifecycle)) {
          // registerWithArgs(Class, Lifecycle, args?)
          lifecycle = implOrArgsOrLifecycle as Lifecycle;
          namedArgs = argsOrLifecycle as Record<string | symbol, any> | undefined;
        } else {
          // registerWithArgs(Class, args)
          namedArgs = implOrArgsOrLifecycle as Record<string | symbol, any>;
        }
      }
    } else {
      // 情况 2: token 是字符串或 Symbol
      if (!implOrArgsOrLifecycle || typeof implOrArgsOrLifecycle !== "function") {
        throw new Error(`registerWithArgs: 当使用字符串或 Symbol 作为 token 时，必须提供实现类作为第二个参数`);
      }
      actualImpl = implOrArgsOrLifecycle as Constructor<T>;

      // 解析参数
      if (argsOrLifecycle !== undefined) {
        if (typeof argsOrLifecycle === "string" && Object.values(Lifecycle).includes(argsOrLifecycle as Lifecycle)) {
          // registerWithArgs(token, Class, Lifecycle, args?)
          lifecycle = argsOrLifecycle as Lifecycle;
          namedArgs = args;
        } else {
          // registerWithArgs(token, Class, args)
          namedArgs = argsOrLifecycle as Record<string | symbol, any>;
        }
      }
    }

    // 使用工厂函数延迟创建，在 resolve 时才创建实例
    this.register(token, {
      useFactory: async () => {
        return await this.constructInstance(actualImpl, namedArgs);
      }
    }, lifecycle);

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
      }
    }

    if (!registration) {
      const tokenStr = tokenToString(token);
      const hint = typeof token === "function"
        ? "请使用 @singleton() 或 @transient() 装饰器，或手动注册服务。"
        : "请先使用 container.register() 注册服务。";
      const chain = this.resolutionStack.size > 0
        ? `\n依赖链: ${[...this.resolutionStack].map(tokenToString).join(" -> ")} -> ${tokenStr}`
        : "";
      throw new Error(`服务未注册: ${tokenStr}。${hint}${chain}`);
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
  }

  /**
   * 销毁容器，调用所有单例的 dispose 方法
   */
  async dispose(): Promise<void> {
    for (const { instance, method } of this.disposables) {
      try {
        await instance[method]();
      } catch (error: any) {
        console.error(`销毁服务失败: ${error.message}`);
      }
    }

    this.disposables = [];

    // 清除所有单例实例
    for (const registration of this.registrations.values()) {
      registration.instance = undefined;
    }
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
   * @param providedArgs 可选的预提供命名参数对象，通过 @inject 的 token 匹配
   *                     支持字符串、Symbol、类作为 key
   */
  private async constructInstance<T>(target: Constructor<T>, providedArgs?: Record<string | symbol, any>): Promise<T> {
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
      const hasValidToken = token && token !== Object && token !== undefined;

      // 特殊处理：如果注入的是 ServiceContainer 本身，返回当前容器实例
      if (hasValidToken && token === ServiceContainer) {
        args.push(this);
        continue;
      }

      // 尝试从 providedArgs 中找到命名参数
      let foundInProvided = false;
      if (providedArgs && hasValidToken) {
        // 支持三种 key 类型：字符串、Symbol、类/函数
        const value = (providedArgs as any)[token];
        if (value !== undefined) {
          args.push(value);
          foundInProvided = true;
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
          `无法解析 ${target.name} 的第 ${i + 1} 个构造函数参数（索引 ${i}，类型: ${paramTypes[i]?.name || 'unknown'}）。` +
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
        try {
          args.push(await this.resolve(token));
        } catch (error: any) {
          throw new Error(
            `解析 ${target.name} 的第 ${i + 1} 个构造函数参数失败（索引 ${i}，token: ${tokenToString(token)}）: ${error.message}`
          );
        }
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
export const globalServiceContainer = new ServiceContainer();
