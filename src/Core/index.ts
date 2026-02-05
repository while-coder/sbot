/**
 * 核心服务容器模块导出
 */
export { IService, ServiceLifetime, ServiceConfiguration, ServiceDescriptor } from "./IService";
export { ServiceContainer, globalContainer } from "./ServiceContainer";
export { registerCoreServices, createUserServiceContainer } from "./ServiceRegistration";
