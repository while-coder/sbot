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
 *   async connect() { await db.connect(); }
 *
 *   @dispose()
 *   async disconnect() { await db.close(); }
 * }
 *
 * @transient()
 * class UserService {
 *   constructor(private db: DatabaseService) {}
 * }
 *
 * // 解析（自动注入依赖）
 * const userService = await globalContainer.resolve(UserService);
 * ```
 */

// 容器
export { ServiceContainer, globalServiceContainer } from "./ServiceContainer";

// 装饰器
export { transient, singleton, inject, init, dispose } from "./decorators";

// 类型
export { InjectionToken, Constructor, AbstractConstructor, Lifecycle, Provider, ClassProvider, FactoryProvider, ValueProvider } from "./types";
