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

// 容器
export { Container, container } from "./Container";

// 装饰器
export { injectable, singleton, inject, init, dispose } from "./decorators";

// 类型
export { InjectionToken, Constructor, Lifecycle, Provider, ClassProvider, FactoryProvider, ValueProvider } from "./types";
