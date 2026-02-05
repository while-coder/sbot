import { IService, ServiceDescriptor, ServiceLifetime, ServiceConfiguration } from "./IService";
import { LoggerService } from "../LoggerService";

const logger = LoggerService.getLogger("ServiceContainer.ts");

/**
 * 服务容器
 * 提供依赖注入和服务生命周期管理
 * 类似 .NET 的 ServiceCollection/ServiceProvider
 */
export class ServiceContainer {
  /**
   * 服务描述符集合
   */
  private descriptors: Map<string, ServiceDescriptor> = new Map();

  /**
   * 单例服务实例缓存
   */
  private singletonInstances: Map<string, IService> = new Map();

  /**
   * 作用域服务实例缓存
   */
  private scopedInstances: Map<string, IService> = new Map();

  /**
   * 父容器（用于作用域）
   */
  private parent?: ServiceContainer;

  /**
   * 容器名称（用于调试）
   */
  private readonly containerName: string;

  /**
   * 是否是根容器
   */
  private readonly isRoot: boolean;

  constructor(name: string = "root", parent?: ServiceContainer) {
    this.containerName = name;
    this.parent = parent;
    this.isRoot = !parent;
  }

  /**
   * 注册服务
   * @param descriptor 服务描述符
   */
  register<T extends IService>(descriptor: ServiceDescriptor<T>): this {
    if (this.descriptors.has(descriptor.name)) {
      logger.warn(`服务 ${descriptor.name} 已注册，将被覆盖`);
    }

    this.descriptors.set(descriptor.name, descriptor);
    logger.debug(`注册服务: ${descriptor.name} (${descriptor.lifetime})`);

    return this;
  }

  /**
   * 注册单例服务
   */
  addSingleton<T extends IService>(
    name: string,
    implementation: new (...args: any[]) => T,
    config?: ServiceConfiguration
  ): this {
    return this.register({
      name,
      implementation,
      lifetime: ServiceLifetime.SINGLETON,
      configuration: config
    });
  }

  /**
   * 注册作用域服务
   */
  addScoped<T extends IService>(
    name: string,
    implementation: new (...args: any[]) => T,
    config?: ServiceConfiguration
  ): this {
    return this.register({
      name,
      implementation,
      lifetime: ServiceLifetime.SCOPED,
      configuration: config
    });
  }

  /**
   * 注册瞬时服务
   */
  addTransient<T extends IService>(
    name: string,
    implementation: new (...args: any[]) => T,
    config?: ServiceConfiguration
  ): this {
    return this.register({
      name,
      implementation,
      lifetime: ServiceLifetime.TRANSIENT,
      configuration: config
    });
  }

  /**
   * 使用工厂函数注册服务
   */
  addFactory<T extends IService>(
    name: string,
    factory: (container: ServiceContainer) => T | Promise<T>,
    lifetime: ServiceLifetime = ServiceLifetime.SINGLETON,
    config?: ServiceConfiguration
  ): this {
    return this.register({
      name,
      implementation: class {
        serviceName = name;
      } as any,
      lifetime,
      configuration: config,
      factory
    });
  }

  /**
   * 获取服务
   * @param name 服务名称
   * @returns 服务实例
   */
  async get<T extends IService>(name: string): Promise<T> {
    // 1. 查找服务描述符
    let descriptor = this.descriptors.get(name);

    // 如果当前容器没有，尝试从父容器查找
    if (!descriptor && this.parent) {
      return this.parent.get<T>(name);
    }

    if (!descriptor) {
      throw new Error(`服务 ${name} 未注册`);
    }

    // 2. 检查服务是否启用
    if (descriptor.configuration?.enabled === false) {
      throw new Error(`服务 ${name} 已禁用`);
    }

    // 3. 根据生命周期获取或创建实例
    return await this.resolveService<T>(name, descriptor);
  }

  /**
   * 尝试获取服务（不抛出异常）
   */
  async tryGet<T extends IService>(name: string): Promise<T | null> {
    try {
      return await this.get<T>(name);
    } catch {
      return null;
    }
  }

  /**
   * 检查服务是否已注册
   */
  has(name: string): boolean {
    return this.descriptors.has(name) || (this.parent?.has(name) ?? false);
  }

  /**
   * 创建作用域容器
   * 用于管理作用域服务（如每个用户会话）
   */
  createScope(scopeName: string = "scope"): ServiceContainer {
    return new ServiceContainer(`${this.containerName}/${scopeName}`, this);
  }

  /**
   * 解析服务依赖
   */
  private async resolveService<T extends IService>(
    name: string,
    descriptor: ServiceDescriptor
  ): Promise<T> {
    switch (descriptor.lifetime) {
      case ServiceLifetime.SINGLETON:
        return await this.resolveSingleton<T>(name, descriptor);

      case ServiceLifetime.SCOPED:
        return await this.resolveScoped<T>(name, descriptor);

      case ServiceLifetime.TRANSIENT:
        return await this.createInstance<T>(descriptor);

      default:
        throw new Error(`未知的服务生命周期: ${descriptor.lifetime}`);
    }
  }

  /**
   * 解析单例服务
   */
  private async resolveSingleton<T extends IService>(
    name: string,
    descriptor: ServiceDescriptor
  ): Promise<T> {
    // 单例应该在根容器中缓存
    const container = this.getRootContainer();

    if (container.singletonInstances.has(name)) {
      return container.singletonInstances.get(name) as T;
    }

    const instance = await this.createInstance<T>(descriptor);
    container.singletonInstances.set(name, instance);

    logger.debug(`创建单例服务: ${name}`);
    return instance;
  }

  /**
   * 解析作用域服务
   */
  private async resolveScoped<T extends IService>(
    name: string,
    descriptor: ServiceDescriptor
  ): Promise<T> {
    // 作用域服务在当前容器缓存
    if (this.scopedInstances.has(name)) {
      return this.scopedInstances.get(name) as T;
    }

    const instance = await this.createInstance<T>(descriptor);
    this.scopedInstances.set(name, instance);

    logger.debug(`创建作用域服务: ${name} (容器: ${this.containerName})`);
    return instance;
  }

  /**
   * 创建服务实例
   */
  private async createInstance<T extends IService>(
    descriptor: ServiceDescriptor
  ): Promise<T> {
    let instance: T;

    // 如果有工厂函数，使用工厂创建
    if (descriptor.factory) {
      instance = await descriptor.factory(this) as T;
    } else {
      // 否则直接实例化
      const config = descriptor.configuration?.config || {};
      instance = new descriptor.implementation(config) as T;
    }

    // 初始化服务
    if (instance.initialize && !instance.isInitialized) {
      await instance.initialize();
      if (instance.isInitialized !== undefined) {
        (instance as any).isInitialized = true;
      }
    }

    return instance;
  }

  /**
   * 获取根容器
   */
  private getRootContainer(): ServiceContainer {
    let container: ServiceContainer = this;
    while (container.parent) {
      container = container.parent;
    }
    return container;
  }

  /**
   * 获取所有已注册的服务名称
   */
  getServiceNames(): string[] {
    const names = Array.from(this.descriptors.keys());
    if (this.parent) {
      names.push(...this.parent.getServiceNames());
    }
    return [...new Set(names)];
  }

  /**
   * 释放容器中的所有服务
   */
  async dispose(): Promise<void> {
    logger.info(`释放容器: ${this.containerName}`);

    // 释放作用域服务
    for (const [name, instance] of this.scopedInstances.entries()) {
      if (instance.dispose) {
        try {
          await instance.dispose();
          logger.debug(`释放作用域服务: ${name}`);
        } catch (error: any) {
          logger.error(`释放服务 ${name} 失败: ${error.message}`);
        }
      }
    }
    this.scopedInstances.clear();

    // 如果是根容器，释放单例服务
    if (this.isRoot) {
      for (const [name, instance] of this.singletonInstances.entries()) {
        if (instance.dispose) {
          try {
            await instance.dispose();
            logger.debug(`释放单例服务: ${name}`);
          } catch (error: any) {
            logger.error(`释放服务 ${name} 失败: ${error.message}`);
          }
        }
      }
      this.singletonInstances.clear();
    }
  }

  /**
   * 打印容器信息（调试用）
   */
  debug(): void {
    console.log(`\n=== 服务容器: ${this.containerName} ===`);
    console.log(`是否根容器: ${this.isRoot}`);
    console.log(`\n已注册服务 (${this.descriptors.size}):`);

    for (const [name, descriptor] of this.descriptors.entries()) {
      const enabled = descriptor.configuration?.enabled !== false;
      const status = enabled ? "✓" : "✗";
      console.log(`  ${status} ${name} (${descriptor.lifetime})`);
    }

    console.log(`\n单例实例 (${this.singletonInstances.size}):`);
    for (const name of this.singletonInstances.keys()) {
      console.log(`  • ${name}`);
    }

    console.log(`\n作用域实例 (${this.scopedInstances.size}):`);
    for (const name of this.scopedInstances.keys()) {
      console.log(`  • ${name}`);
    }

    console.log(`\n==============================\n`);
  }
}

/**
 * 全局服务容器实例
 */
export const globalContainer = new ServiceContainer("global");
