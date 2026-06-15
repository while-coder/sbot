/**
 * 依赖注入模块
 *
 * 提供 tsyringe 风格的依赖注入支持：
 *
 * @example
 * ```ts
 * import { singleton, transient, inject, init, dispose, globalServiceContainer } from "scorpio.di";
 *
 * @singleton()
 * class DatabaseService {
 *   @init()
 *   connect() { db.connectSync(); }   // @init 必须同步；异步初始化在 resolve 后显式 await
 *
 *   @dispose()
 *   async disconnect() { await db.close(); }   // dispose 仍允许 async
 * }
 *
 * @transient()
 * class UserService {
 *   constructor(private db: DatabaseService) {}
 * }
 *
 * // 解析（同步）
 * const userService = globalContainer.resolve(UserService);
 * ```
 */

// 容器
export { ServiceContainer, globalServiceContainer } from "./ServiceContainer";

// 装饰器
export { transient, singleton, inject, init, dispose } from "./decorators";

// 类型
export { InjectionToken, Constructor, AbstractConstructor, Lifecycle, Provider, ClassProvider, FactoryProvider, ValueProvider } from "./types";
