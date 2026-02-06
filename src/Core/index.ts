/**
 * 核心依赖注入模块
 *
 * 提供 tsyringe 风格的依赖注入支持：
 *
 * @example
 * ```ts
 * import { singleton, injectable, inject, init, dispose, container } from "./Core";
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
 * @injectable()
 * class UserService {
 *   constructor(private db: DatabaseService) {}
 * }
 *
 * // 解析（自动注入依赖）
 * const userService = await container.resolve(UserService);
 * ```
 */

// ===== 新 API（推荐使用）=====

// 容器
export { Container, container } from "./Container";

// 装饰器
export { injectable, singleton, inject, init, dispose } from "./decorators";

// 类型
export { InjectionToken, Constructor, Lifecycle, Provider, ClassProvider, FactoryProvider, ValueProvider } from "./types";

// ===== 旧 API（向后兼容，已废弃）=====

/** @deprecated 使用新的 Container 和装饰器 API */
export { IService, ServiceLifetime, ServiceConfiguration, ServiceDescriptor } from "./IService";

/** @deprecated 使用新的 container（小写）代替 */
export { ServiceContainer, globalContainer } from "./ServiceContainer";

/** @deprecated 使用装饰器自动注册代替手动注册 */
export { registerCoreServices, createUserServiceContainer } from "./ServiceRegistration";
