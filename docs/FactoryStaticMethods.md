# Factory 静态方法重构

## 概述

将 `ModelServiceFactory` 和 `EmbeddingServiceFactory` 的实例方法改为静态方法，简化使用方式，无需创建工厂实例。

## 修改内容

### ModelServiceFactory

**修改前**：
```typescript
export class ModelServiceFactory {
  private readonly cache = new Map<string, IModelService>();

  async getModelService(modelName: string): Promise<IModelService> {
    // ...
  }

  async clearCache(): Promise<void> {
    // ...
  }

  hasCached(modelName: string): boolean {
    // ...
  }

  getCachedModels(): string[] {
    // ...
  }
}

// 使用方式
const factory = new ModelServiceFactory();
const modelService = await factory.getModelService("gpt-4");
await factory.clearCache();
```

**修改后**：
```typescript
export class ModelServiceFactory {
  private static readonly cache = new Map<string, IModelService>();

  static async getModelService(modelName: string): Promise<IModelService> {
    // ...
  }

  static async clearCache(): Promise<void> {
    // ...
  }

  static hasCached(modelName: string): boolean {
    // ...
  }

  static getCachedModels(): string[] {
    // ...
  }
}

// 使用方式（无需实例化）
const modelService = await ModelServiceFactory.getModelService("gpt-4");
await ModelServiceFactory.clearCache();
```

### EmbeddingServiceFactory

**修改前**：
```typescript
export class EmbeddingServiceFactory {
  private readonly cache = new Map<string, IEmbeddingService>();

  async getEmbeddingService(config: EmbeddingConfig): Promise<IEmbeddingService> {
    // ...
  }

  async clearCache(): Promise<void> {
    // ...
  }

  hasCached(config: EmbeddingConfig): boolean {
    // ...
  }

  getCacheSize(): number {
    // ...
  }
}

// 使用方式
const factory = new EmbeddingServiceFactory();
const embeddingService = await factory.getEmbeddingService(config);
await factory.clearCache();
```

**修改后**：
```typescript
export class EmbeddingServiceFactory {
  private static readonly cache = new Map<string, IEmbeddingService>();

  static async getEmbeddingService(config: EmbeddingConfig): Promise<IEmbeddingService> {
    // ...
  }

  static async clearCache(): Promise<void> {
    // ...
  }

  static hasCached(config: EmbeddingConfig): boolean {
    // ...
  }

  static getCacheSize(): number {
    // ...
  }
}

// 使用方式（无需实例化）
const embeddingService = await EmbeddingServiceFactory.getEmbeddingService(config);
await EmbeddingServiceFactory.clearCache();
```

## 修改的文件

### 核心文件

1. **[Model/ModelServiceFactory.ts](../src/Model/ModelServiceFactory.ts)**
   - 所有方法改为 `static`
   - `cache` 改为 `static readonly`
   - 删除了 `@singleton()` 装饰器（不再需要）

2. **[Embedding/EmbeddingServiceFactory.ts](../src/Embedding/EmbeddingServiceFactory.ts)**
   - 所有方法改为 `static`
   - `cache` 改为 `static readonly`

### 使用方代码

3. **[UserService/UserServiceBase.ts](../src/UserService/UserServiceBase.ts)**
   - 删除 `new ModelServiceFactory()`
   - 直接调用 `ModelServiceFactory.getModelService()`
   - 删除 `new EmbeddingServiceFactory()`
   - 直接调用 `EmbeddingServiceFactory.getEmbeddingService()`

### 示例文件

4. **[examples/EmbeddingServiceExample.ts](../examples/EmbeddingServiceExample.ts)**
   - 更新所有 factory 调用为静态方法

5. **[examples/EmbeddingConfigExample.ts](../examples/EmbeddingConfigExample.ts)**
   - 更新所有 factory 调用为静态方法

## 使用示例

### ModelServiceFactory

```typescript
import { ModelServiceFactory } from "./Model";
import { config } from "./Config";

// 获取模型服务
const modelService = await ModelServiceFactory.getModelService(config.getModelName());

// 调用模型
const response = await modelService.invoke("Hello, world!");

// 检查缓存
if (ModelServiceFactory.hasCached("gpt-4")) {
  console.log("模型已缓存");
}

// 清理缓存
await ModelServiceFactory.clearCache();
```

### EmbeddingServiceFactory

```typescript
import { EmbeddingServiceFactory } from "./Embedding";
import { config } from "./Config";

// 获取 embedding 服务
const embeddingConfig = config.getCurrentEmbedding();
const embeddingService = await EmbeddingServiceFactory.getEmbeddingService(embeddingConfig);

// 生成 embedding
const embedding = await embeddingService.embedQuery("Hello, world!");

// 检查缓存
console.log(`缓存数量: ${EmbeddingServiceFactory.getCacheSize()}`);

// 清理缓存
await EmbeddingServiceFactory.clearCache();
```

### 在 UserServiceBase 中的使用

```typescript
// 创建 DI 容器并注册服务
const container = new Container();

// 注册模型服务（使用静态方法）
container.registerInstance(
  IModelService,
  await ModelServiceFactory.getModelService(config.getModelName())
);

// 注册 embedding 服务（使用静态方法）
const embeddingConfig = config.getCurrentEmbedding();
if (embeddingConfig) {
  container.registerInstance(
    IEmbeddingService,
    await EmbeddingServiceFactory.getEmbeddingService(embeddingConfig)
  );
}

// 解析 AgentService
const agentService = await container.resolve(AgentService);
```

## 优势

### 1. 简化代码

**之前**：
```typescript
const modelFactory = new ModelServiceFactory();
const modelService = await modelFactory.getModelService("gpt-4");

const embeddingFactory = new EmbeddingServiceFactory();
const embeddingService = await embeddingFactory.getEmbeddingService(config);
```

**现在**：
```typescript
const modelService = await ModelServiceFactory.getModelService("gpt-4");
const embeddingService = await EmbeddingServiceFactory.getEmbeddingService(config);
```

### 2. 全局缓存

静态方法天然共享缓存，无需担心不同实例之间的缓存不一致问题。

**之前**：
```typescript
const factory1 = new ModelServiceFactory();
const factory2 = new ModelServiceFactory();
// factory1 和 factory2 的缓存是独立的（不理想）
```

**现在**：
```typescript
// 所有地方使用的都是同一个全局缓存
await ModelServiceFactory.getModelService("gpt-4"); // 创建并缓存
await ModelServiceFactory.getModelService("gpt-4"); // 使用缓存
```

### 3. 减少内存占用

不需要创建工厂实例，减少对象数量和内存占用。

### 4. 更清晰的语义

静态方法明确表示这是一个全局的、共享的服务工厂。

## 注意事项

### 缓存是全局的

所有地方使用的都是同一个缓存，这意味着：

```typescript
// 在任何地方获取的都是相同的实例
const service1 = await ModelServiceFactory.getModelService("gpt-4");
const service2 = await ModelServiceFactory.getModelService("gpt-4");
console.log(service1 === service2); // true
```

### 清理缓存会影响所有使用者

```typescript
// 清理缓存会影响整个应用
await ModelServiceFactory.clearCache();
// 之后所有的 getModelService 调用都会创建新实例
```

### 测试时需要清理缓存

在单元测试中，每个测试用例之间应该清理缓存以避免相互影响：

```typescript
afterEach(async () => {
  await ModelServiceFactory.clearCache();
  await EmbeddingServiceFactory.clearCache();
});
```

## 迁移指南

如果你的代码中使用了旧的实例方法，按以下步骤迁移：

### 步骤 1: 删除实例化代码

```typescript
// 删除这些行
const modelFactory = new ModelServiceFactory();
const embeddingFactory = new EmbeddingServiceFactory();
```

### 步骤 2: 将实例方法调用改为静态方法

```typescript
// 之前
const model = await modelFactory.getModelService("gpt-4");
await modelFactory.clearCache();

// 现在
const model = await ModelServiceFactory.getModelService("gpt-4");
await ModelServiceFactory.clearCache();
```

### 步骤 3: 更新导入（如果需要）

导入语句保持不变，但现在你可以直接使用类名调用方法：

```typescript
import { ModelServiceFactory } from "./Model";
import { EmbeddingServiceFactory } from "./Embedding";

// 直接使用
await ModelServiceFactory.getModelService("gpt-4");
await EmbeddingServiceFactory.getEmbeddingService(config);
```

## 兼容性

- ✅ 向下兼容：所有方法签名保持不变
- ✅ 功能不变：缓存机制和行为完全相同
- ⚠️ 不兼容旧代码：不能再使用 `new` 创建实例（但实际上以前也不应该这样用）

## 总结

将工厂方法改为静态方法是一个简单但有效的重构，带来了以下好处：

1. **更简洁的 API**：无需实例化即可使用
2. **全局缓存**：天然支持跨模块的缓存共享
3. **减少内存**：不需要创建工厂对象
4. **更清晰的语义**：明确表示这是全局单例模式

这个改动完全向下兼容，不影响现有功能，只是让代码更加简洁和易用。
