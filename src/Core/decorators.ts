import "reflect-metadata";
import { InjectionToken, Lifecycle } from "./types";

/**
 * Metadata keys
 */
export const METADATA_KEYS = {
  /** 标记类为可注入 */
  INJECTABLE: "di:injectable",
  /** 标记类的生命周期 */
  LIFECYCLE: "di:lifecycle",
  /** 标记构造函数参数的注入令牌 */
  INJECT_TOKENS: "di:inject_tokens",
  /** 标记类需要在创建后调用的初始化方法 */
  INIT_METHOD: "di:init_method",
  /** 标记类需要在销毁时调用的销毁方法 */
  DISPOSE_METHOD: "di:dispose_method",
};

/**
 * @injectable() - 标记类为可注入的
 * 
 * @example
 * ```ts
 * @injectable()
 * class MyService {
 *   constructor(private dep: OtherService) {}
 * }
 * ```
 */
export function injectable(): ClassDecorator {
  return function (target: Function) {
    Reflect.defineMetadata(METADATA_KEYS.INJECTABLE, true, target);
  };
}

/**
 * @singleton() - 标记类为单例可注入的
 * 
 * @example
 * ```ts
 * @singleton()
 * class DatabaseService {
 *   // 整个应用只会创建一个实例
 * }
 * ```
 */
export function singleton(): ClassDecorator {
  return function (target: Function) {
    Reflect.defineMetadata(METADATA_KEYS.INJECTABLE, true, target);
    Reflect.defineMetadata(METADATA_KEYS.LIFECYCLE, Lifecycle.Singleton, target);
  };
}

/**
 * @inject(token) - 指定构造函数参数的注入令牌
 * 用于注入接口或字符串/Symbol 令牌对应的服务
 * 
 * @example
 * ```ts
 * @injectable()
 * class MyService {
 *   constructor(
 *     @inject("API_KEY") private apiKey: string,
 *     @inject(ILogger) private logger: ILogger
 *   ) {}
 * }
 * ```
 */
export function inject(token: InjectionToken): ParameterDecorator {
  return function (target: Object, _propertyKey: string | symbol | undefined, parameterIndex: number) {
    const existingTokens: Map<number, InjectionToken> =
      Reflect.getOwnMetadata(METADATA_KEYS.INJECT_TOKENS, target) || new Map();
    existingTokens.set(parameterIndex, token);
    Reflect.defineMetadata(METADATA_KEYS.INJECT_TOKENS, existingTokens, target);
  };
}

/**
 * @init() - 标记方法为初始化方法，在实例创建后自动调用
 * 
 * @example
 * ```ts
 * @singleton()
 * class DatabaseService {
 *   @init()
 *   async initialize() {
 *     await this.connect();
 *   }
 * }
 * ```
 */
export function init(): MethodDecorator {
  return function (target: Object, propertyKey: string | symbol) {
    Reflect.defineMetadata(METADATA_KEYS.INIT_METHOD, propertyKey, target.constructor);
  };
}

/**
 * @dispose() - 标记方法为销毁方法，在容器销毁时自动调用
 * 
 * @example
 * ```ts
 * @singleton()
 * class DatabaseService {
 *   @dispose()
 *   async cleanup() {
 *     await this.disconnect();
 *   }
 * }
 * ```
 */
export function dispose(): MethodDecorator {
  return function (target: Object, propertyKey: string | symbol) {
    Reflect.defineMetadata(METADATA_KEYS.DISPOSE_METHOD, propertyKey, target.constructor);
  };
}

/**
 * 获取类是否标记为可注入
 */
export function isInjectable(target: Function): boolean {
  return Reflect.getMetadata(METADATA_KEYS.INJECTABLE, target) === true;
}

/**
 * 获取类的生命周期
 */
export function getLifecycle(target: Function): Lifecycle | undefined {
  return Reflect.getMetadata(METADATA_KEYS.LIFECYCLE, target);
}

/**
 * 获取构造函数参数的注入令牌
 */
export function getInjectTokens(target: Function): Map<number, InjectionToken> {
  return Reflect.getOwnMetadata(METADATA_KEYS.INJECT_TOKENS, target) || new Map();
}

/**
 * 获取构造函数参数类型（通过 reflect-metadata）
 */
export function getParamTypes(target: Function): any[] {
  return Reflect.getMetadata("design:paramtypes", target) || [];
}

/**
 * 获取初始化方法名
 */
export function getInitMethod(target: Function): string | symbol | undefined {
  return Reflect.getMetadata(METADATA_KEYS.INIT_METHOD, target);
}

/**
 * 获取销毁方法名
 */
export function getDisposeMethod(target: Function): string | symbol | undefined {
  return Reflect.getMetadata(METADATA_KEYS.DISPOSE_METHOD, target);
}
