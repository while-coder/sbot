# ModelServiceFactory 优化说明

## 问题背景

之前的实现中，ImportanceEvaluator 和 MemoryCompressor 都需要使用模型服务，但存在以下问题：

1. **ImportanceEvaluator** 在构造函数中创建了自己的内部 Container
2. 每次调用 `resolve<IModelService>("Model")` 都需要等待异步操作
3. 无法灵活地根据不同的 modelName 获取对应的服务实例
4. 代码重复，不符合 DRY 原则

## 优化方案

创建 **ModelServiceFactory** 工厂类，统一管理模型服务的创建和缓存。

### 核心特性

1. **单例模式**：使用 `@singleton()` 装饰器，全局唯一实例
2. **缓存机制**：相同 modelName 返回同一个 IModelService 实例
3. **懒加载**：只在需要时创建模型服务
4. **依赖注入**：通过构造函数注入 modelName 和 factory

## 实现细节

### 1. ModelServiceFactory.ts

```typescript
@singleton()
export class ModelServiceFactory {
  private readonly cache = new Map<string, IModelService>();

  async getModelService(modelName: string): Promise<IModelService> {
    // 从缓存中获取
    if (this.cache.has(modelName)) {
      return this.cache.get(modelName)!;
    }

    // 创建新实例并缓存
    const service = await this.createModelService(modelName);
    this.cache.set(modelName, service);
    return service;
  }

  private async createModelService(modelName: string): Promise<IModelService> {
    const modelConfig = config.getModel(modelName);
    if (!modelConfig) {
      throw new Error(`模型配置 "${modelName}" 未找到`);
    }

    switch (modelConfig.provider) {
      case "openai":
        const service = new OpenAIModelService(modelConfig);
        await service.initialize();
        return service;
      default:
        throw new Error(`不支持的模型提供者: ${modelConfig.provider}`);
    }
  }
}
```

### 2. ImportanceEvaluator 重构

**之前的实现：**
```typescript
@singleton()
export class ImportanceEvaluator {
  private readonly container: Container;

  constructor(@inject(MODEL_NAME) private modelName: string) {
    this.container = new Container();
    this.container.registerInstance(MODEL_NAME, this.modelName);
    this.container.register("Model", {
      useFactory: createModelService,
    }, Lifecycle.Singleton);
  }

  async evaluate(content: string): Promise<ImportanceEvaluation> {
    const model = await this.container.resolve<IModelService>("Model");
    // ...
  }
}
```

**优化后的实现：**
```typescript
@singleton()
export class ImportanceEvaluator {
  private modelService: IModelService | null = null;

  constructor(
    @inject(MODEL_NAME) private modelName: string,
    @inject(ModelServiceFactory) private modelFactory: ModelServiceFactory
  ) {}

  private async getModelService(): Promise<IModelService> {
    if (!this.modelService) {
      this.modelService = await this.modelFactory.getModelService(this.modelName);
    }
    return this.modelService;
  }

  async evaluate(content: string): Promise<ImportanceEvaluation> {
    const model = await this.getModelService();
    // ...
  }
}
```

### 3. MemoryCompressor 重构

**之前的实现：**
```typescript
@singleton()
export class MemoryCompressor {
  constructor(@inject(IModelService) private modelService: IModelService) {}

  private async generateCompressedContent(...): Promise<string> {
    const response = await this.modelService.invoke(prompt);
    // ...
  }
}
```

**优化后的实现：**
```typescript
@singleton()
export class MemoryCompressor {
  private modelService: IModelService | null = null;

  constructor(
    @inject(MODEL_NAME) private modelName: string,
    @inject(ModelServiceFactory) private modelFactory: ModelServiceFactory
  ) {}

  private async getModelService(): Promise<IModelService> {
    if (!this.modelService) {
      this.modelService = await this.modelFactory.getModelService(this.modelName);
    }
    return this.modelService;
  }

  private async generateCompressedContent(...): Promise<string> {
    const model = await this.getModelService();
    const response = await model.invoke(prompt);
    // ...
  }
}
```

## 使用方式

### 基本用法

```typescript
import { Container } from "./Core";
import { MODEL_NAME, ModelServiceFactory } from "./Model";

const container = new Container();

// 1. 注册 MODEL_NAME（必需）
container.registerInstance(MODEL_NAME, "gpt-4");

// 2. ModelServiceFactory 会自动注册（有 @singleton() 装饰器）
// 3. ImportanceEvaluator 和 MemoryCompressor 会自动注册

// 4. 解析服务
const evaluator = await container.resolve(ImportanceEvaluator);
const result = await evaluator.evaluate("some text");
```

### 高级用法：动态切换模型

```typescript
const factory = await container.resolve(ModelServiceFactory);

// 获取不同的模型服务
const gpt4 = await factory.getModelService("gpt-4");
const gpt35 = await factory.getModelService("gpt-3.5-turbo");

// gpt4 和 gpt35 是不同的实例，但都被缓存
// 再次调用会返回缓存的实例
const gpt4Again = await factory.getModelService("gpt-4");
console.log(gpt4 === gpt4Again); // true
```

### 使用示例：MemoryService

```typescript
const container = new Container();

// 1. 注册配置
container.registerInstance("MemoryServiceConfig", {
  userId: "user1",
  dbPath: "./memory.db",
  embeddingConfig: {
    apiKey: "sk-xxx",
    baseURL: "https://api.openai.com"
  }
});

// 2. 注册 MODEL_NAME
container.registerInstance(MODEL_NAME, "gpt-4");

// 3. 解析 MemoryService（自动注入 ImportanceEvaluator 和 MemoryCompressor）
const memoryService = await container.resolve(MemoryService);
await memoryService.init();

// 4. 使用
await memoryService.addMemory("这是一个重要的记忆");
```

## 优势总结

### 1. **性能优化**
- ✅ 同一个 modelName 只创建一次实例
- ✅ 懒加载，仅在需要时初始化
- ✅ 避免重复的 container.resolve() 调用

### 2. **代码简化**
- ✅ 移除内部 Container，降低复杂度
- ✅ 统一的模型服务获取方式
- ✅ 代码更清晰易读

### 3. **灵活性**
- ✅ 可以轻松支持多个不同的模型
- ✅ 工厂模式，易于扩展
- ✅ 支持动态切换模型

### 4. **可维护性**
- ✅ 集中管理模型服务创建逻辑
- ✅ 符合单一职责原则
- ✅ 易于测试和 mock

## 设计模式

1. **工厂模式（Factory Pattern）**：ModelServiceFactory 负责创建 IModelService
2. **单例模式（Singleton Pattern）**：使用 @singleton() 装饰器
3. **懒加载模式（Lazy Loading）**：只在首次调用时创建实例
4. **依赖注入（Dependency Injection）**：通过构造函数注入依赖

## 注意事项

1. **必须注册 MODEL_NAME**：使用 ModelServiceFactory 之前必须在容器中注册 MODEL_NAME
2. **MODEL_NAME 是 Symbol**：确保使用 `MODEL_NAME` 而不是字符串
3. **异步初始化**：getModelService() 是异步方法，需要 await
4. **缓存管理**：默认永久缓存，如需清除可调用 `clearCache()`

## 未来优化方向

1. **LRU 缓存**：限制缓存大小，避免内存占用过大
2. **TTL 过期**：为缓存添加过期时间
3. **健康检查**：定期检查模型服务可用性
4. **连接池**：对于高频调用场景，实现连接池管理
5. **监控指标**：添加性能监控和使用统计
