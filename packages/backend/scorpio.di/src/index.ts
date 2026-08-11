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
 *   connect() { db.connectSync(); }     // @init 必须同步
 *
 *   @dispose()
 *   cleanup() { db.closeSync(); }       // @dispose 必须同步（与 @init 对齐）
 * }                                      // 异步资源清理由调用方在 dispose 之后显式 await
 *
 * @transient()
 * class UserService {
 *   constructor(private db: DatabaseService) {}
 * }
 *
 * // 解析（同步）
 * const userService = globalContainer.resolve(UserService);
 *
 * // 销毁（同步）：依次调用所有 @dispose 标记的方法
 * globalContainer.dispose();
 * ```
 */

// 容器
export { ServiceContainer, globalServiceContainer } from "./ServiceContainer";

// 装饰器
export { transient, singleton, inject, init, dispose } from "./decorators";

// 类型
export { InjectionToken, Constructor, AbstractConstructor, Lifecycle, Provider, ClassProvider, FactoryProvider, ValueProvider } from "./types";
