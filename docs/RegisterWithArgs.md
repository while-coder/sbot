# Container.registerWithArgs 功能说明

## 概述

`registerWithArgs` 是 `Container` 的增强注册方法，允许你在创建实例时提供自定义参数，同时保留依赖注入的灵活性。

## 核心特性

### 1. 类型匹配，顺序无关

与传统的按位置传参不同，`registerWithArgs` 根据**类型**自动匹配参数：

```typescript
class DatabaseService {
  constructor(
    private host: string,
    private port: number,
    private logger: ILogger
  ) {}
}

// 参数顺序可以任意排列
await container.registerWithArgs(
  DatabaseService,
  5432,           // port: number
  logger,         // logger: ILogger
  "localhost"     // host: string
);
```

### 2. 混合注入模式

你可以只提供部分参数，未提供的参数会自动从容器中解析：

```typescript
// 只提供 host 和 port，logger 从容器解析
container.registerSingleton(ConsoleLogger);

await container.registerWithArgs(
  DatabaseService,
  "localhost",  // host: string
  5432          // port: number
  // logger 自动从容器解析
);
```

### 3. 支持复杂依赖链

即使是复杂的依赖关系，也能正确处理：

```typescript
// ApiService 依赖 DatabaseService
class ApiService {
  constructor(
    private baseURL: string,
    private dbService: DatabaseService
  ) {}
}

// 先注册 DatabaseService
await container.registerWithArgs(DatabaseService, "localhost", 5432);

// 再注册 ApiService，只提供 baseURL
await container.registerWithArgs(
  ApiService,
  "https://api.example.com"
  // dbService 自动从容器解析
);
```

## 方法签名

```typescript
// 重载 1: 使用类作为 token
async registerWithArgs<T>(token: Constructor<T>, ...args: any[]): Promise<this>;

// 重载 2: 使用字符串或 Symbol 作为 token
async registerWithArgs<T>(token: string | symbol, impl: Constructor<T>, ...args: any[]): Promise<this>;
```

### 参数说明

**重载 1（推荐）：**
- **token**: 类构造函数
- **...args**: 构造函数参数
  - 根据类型自动匹配到构造函数参数
  - 未匹配的参数会通过容器解析

**重载 2（接口映射）：**
- **token**: 字符串或 Symbol 令牌
- **impl**: 实现类
- **...args**: 构造函数参数

## 类型匹配规则

### 1. 类类型匹配

```typescript
class Logger {}

const logger = new Logger();
// 会匹配到 constructor(logger: Logger) 中的 logger 参数
```

匹配方式：
- `instanceof` 检查
- 构造函数相等性检查

### 2. 基本类型匹配

```typescript
await container.registerInstance2(
  ConfigService,
  undefined,
  "api-key",    // 匹配 string 类型参数
  3000,         // 匹配 number 类型参数
  true          // 匹配 boolean 类型参数
);
```

支持的基本类型：
- `String` / `string`
- `Number` / `number`
- `Boolean` / `boolean`

### 3. Symbol 类型匹配

```typescript
const CONFIG_TOKEN = Symbol("config");

await container.registerInstance2(
  Service,
  undefined,
  CONFIG_TOKEN  // 匹配 Symbol 类型参数
);
```

### 4. 匹配优先级

每个参数只会被使用一次，匹配顺序：

1. 从左到右遍历构造函数参数
2. 对每个参数，在提供的 args 中查找类型匹配的值
3. 找到后标记该 arg 为已使用，继续下一个参数
4. 如果找不到匹配，尝试从容器解析
5. 如果容器也无法解析，且参数是可选的，注入 `undefined`

## 使用场景

### 场景 1: 配置值注入

适用于需要从配置文件或环境变量读取的值：

```typescript
class DatabaseService {
  constructor(
    private host: string,
    private port: number,
    private logger: ILogger
  ) {}
}

const config = loadConfig();

await container.registerWithArgs(
  DatabaseService,
  config.db.host,    // 来自配置文件
  config.db.port,    // 来自配置文件
  // logger 从容器解析
);
```

### 场景 2: 运行时值注入

适用于运行时才能确定的值：

```typescript
class UserService {
  constructor(
    private userId: string,
    private apiClient: ApiClient
  ) {}
}

// userId 在运行时确定
const userId = getCurrentUserId();

await container.registerWithArgs(
  UserService,
  userId  // 运行时值
  // apiClient 从容器解析
);
```

### 场景 3: 测试环境

在测试中提供 mock 对象：

```typescript
// 生产环境
await container.registerWithArgs(
  EmailService,
  "smtp.example.com",
  587
);

// 测试环境
const mockSmtpClient = new MockSmtpClient();

await container.registerWithArgs(
  EmailService,
  "localhost",
  2525,
  mockSmtpClient  // 注入 mock 对象
);
```

## 与其他注册方法的对比

### registerInstance

```typescript
// 需要手动创建实例
const instance = new DatabaseService("localhost", 5432, logger);
container.registerInstance(DatabaseService, instance);
```

### registerWithArgs

```typescript
// 自动创建实例，支持混合注入
await container.registerWithArgs(
  DatabaseService,
  "localhost",
  5432
  // logger 自动注入
);
```

### register

```typescript
// 每次 resolve 都创建新实例（Transient）或返回缓存（Singleton）
container.register(DatabaseService, { useClass: DatabaseService }, Lifecycle.Singleton);

// 无法提供自定义参数
```

### registerWithArgs

```typescript
// 创建一次，注册为单例，支持自定义参数
await container.registerWithArgs(
  DatabaseService,
  "localhost",
  5432
);
```

## 优势

### 1. 灵活性

可以根据需要提供部分或全部参数：

```typescript
// 全部从容器解析
container.registerSingleton(Service);

// 部分自定义，部分解析
await container.registerWithArgs(Service, "custom-value");

// 全部自定义
await container.registerWithArgs(Service, "value1", "value2", logger);
```

### 2. 可读性

类型匹配使代码更易读，无需关心参数顺序：

```typescript
// 一目了然
await container.registerWithArgs(
  DatabaseService,
  "localhost",  // 明显是 host
  5432          // 明显是 port
);
```

### 3. 类型安全

TypeScript 类型推断确保参数类型正确：

```typescript
// 类型匹配会自动处理参数顺序
await container.registerWithArgs(
  DatabaseService,
  5432,         // number - 自动匹配到 port
  "localhost"   // string - 自动匹配到 host
);
```

## 注意事项

### 1. 字符串类型匹配

由于 TypeScript 的类型擦除，多个 `string` 类型参数无法区分：

```typescript
class Service {
  constructor(
    private host: string,
    private username: string,
    private password: string
  ) {}
}

// ⚠️ 三个 string 参数会按照遇到的顺序匹配
await container.registerWithArgs(
  Service,
  "localhost",    // 匹配第一个 string (host)
  "admin",        // 匹配第二个 string (username)
  "secret"        // 匹配第三个 string (password)
);
```

**解决方案**：使用 `@inject()` 装饰器明确指定令牌：

```typescript
class Service {
  constructor(
    @inject("DB_HOST") private host: string,
    @inject("DB_USER") private username: string,
    @inject("DB_PASS") private password: string
  ) {}
}

container.register("DB_HOST", { useValue: "localhost" });
container.register("DB_USER", { useValue: "admin" });
container.register("DB_PASS", { useValue: "secret" });

await container.registerWithArgs(Service);
```

### 2. 参数复用

每个提供的参数只会被使用一次：

```typescript
class Service {
  constructor(
    private logger1: ILogger,
    private logger2: ILogger
  ) {}
}

const logger = new ConsoleLogger();

// ⚠️ logger 只会匹配到 logger1
// logger2 需要从容器解析或再提供一个 logger 实例
await container.registerWithArgs(Service, logger);
```

### 3. 可选参数

如果参数标记为可选（使用 `@optional()` 装饰器），且无法解析，会注入 `undefined`：

```typescript
class Service {
  constructor(
    private required: string,
    @optional() private optional?: ILogger
  ) {}
}

// optional 参数会是 undefined（如果容器中没有 ILogger）
await container.registerWithArgs(Service, "value");
```

## 完整示例

查看 [examples/RegisterWithArgsExample.ts](../examples/RegisterWithArgsExample.ts) 获取完整的使用示例，包括：

- 基本用法
- 参数顺序无关性演示
- 混合注入模式
- 复杂依赖链处理
- 测试场景应用

## 总结

`registerWithArgs` 提供了一种灵活的方式来创建和注册服务实例：

- ✅ 支持提供自定义参数
- ✅ 自动类型匹配，顺序无关
- ✅ 未提供的参数自动从容器解析
- ✅ 保持类型安全
- ✅ 简化复杂依赖的创建

适用于需要同时使用配置值和依赖注入的场景。
