/**
 * 依赖注入核心类型定义
 * 参考 tsyringe 设计
 */

/**
 * 注入令牌类型
 * 可以是类构造函数（含抽象类）、字符串或 Symbol
 */
export type InjectionToken<T = any> = Constructor<T> | AbstractConstructor<T> | string | symbol;

/**
 * 构造函数类型
 */
export type Constructor<T = any> = new (...args: any[]) => T;

/**
 * 抽象构造函数类型（用于抽象类作为 DI token）
 */
export type AbstractConstructor<T = any> = abstract new (...args: any[]) => T;

/**
 * 服务生命周期
 */
export enum Lifecycle {
  /** 单例：整个应用生命周期内只创建一次 */
  Singleton = "singleton",
  /** 瞬时：每次解析都创建新实例 */
  Transient = "transient",
}

/**
 * 服务提供者 - 描述如何创建服务
 */
export type Provider<T = any> =
  | ClassProvider<T>
  | FactoryProvider<T>
  | ValueProvider<T>;

/**
 * 类提供者
 */
export interface ClassProvider<T = any> {
  useClass: Constructor<T>;
}

/**
 * 工厂提供者
 */
export interface FactoryProvider<T = any> {
  useFactory: (container: any) => T | Promise<T>;
}

/**
 * 值提供者
 */
export interface ValueProvider<T = any> {
  useValue: T;
}

/**
 * 服务注册信息（内部使用）
 */
export interface Registration<T = any> {
  token: InjectionToken<T>;
  provider: Provider<T>;
  lifecycle: Lifecycle;
  instance?: T;
}

/**
 * 判断是否为 ClassProvider
 */
export function isClassProvider<T>(provider: Provider<T>): provider is ClassProvider<T> {
  return (provider as ClassProvider<T>).useClass !== undefined;
}

/**
 * 判断是否为 FactoryProvider
 */
export function isFactoryProvider<T>(provider: Provider<T>): provider is FactoryProvider<T> {
  return (provider as FactoryProvider<T>).useFactory !== undefined;
}

/**
 * 判断是否为 ValueProvider
 */
export function isValueProvider<T>(provider: Provider<T>): provider is ValueProvider<T> {
  return (provider as ValueProvider<T>).useValue !== undefined;
}
