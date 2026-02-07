# EmbeddingService 设计文档

## 概述

EmbeddingService 是参考 ModelService 的架构设计的，用于管理文本向量化（embedding）服务。它提供了统一的接口、工厂模式的实例管理和依赖注入支持。

## 架构设计

### 核心组件

```
Embedding/
├── IEmbeddingService.ts          # 抽象基类（DI token）
├── OpenAIEmbeddingService.ts     # OpenAI 实现
├── EmbeddingServiceFactory.ts    # 工厂类（带缓存）
└── index.ts                      # 模块导出
```

### 设计模式

1. **抽象工厂模式**：通过 `IEmbeddingService` 定义统一接口
2. **工厂模式**：`EmbeddingServiceFactory` 负责创建和缓存实例
3. **依赖注入**：使用抽象类作为 DI token
4. **单例缓存**：相同配置的服务实例会被缓存复用

## 使用方式

### 1. 直接使用工厂

```typescript
import { EmbeddingServiceFactory, EmbeddingConfig } from "./Embedding";

const factory = new EmbeddingServiceFactory();

const config: EmbeddingConfig = {
  apiKey: "sk-xxx",
  baseURL: "https://api.openai.com/v1",
  model: "text-embedding-ada-002"
};

const embeddingService = await factory.getEmbeddingService(config);

// 单个文本
const embedding = await embeddingService.embedQuery("Hello world");

// 批量文本
const embeddings = await embeddingService.embedDocuments(["Hello", "World"]);
```

### 2. 依赖注入容器

```typescript
import { Container } from "./Core";
import { IEmbeddingService, EmbeddingServiceFactory } from "./Embedding";

const container = new Container();

// 注册 embedding 服务
const factory = new EmbeddingServiceFactory();
const embeddingService = await factory.getEmbeddingService(config);
container.registerInstance(IEmbeddingService, embeddingService);

// 在其他服务中注入使用
@transient()
class MemoryService {
  constructor(
    @inject(IEmbeddingService) private embeddings: IEmbeddingService
  ) {}

  async addMemory(text: string) {
    const embedding = await this.embeddings.embedQuery(text);
    // ...
  }
}
```

## 与 MemoryService 的集成

### 修改前（直接使用 OpenAIEmbeddings）

```typescript
export interface MemoryServiceConfig {
  userId: string;
  dbPath: string;
  embeddingConfig: {
    apiKey: string;
    baseURL?: string;
    model?: string;
  };
}

export class MemoryService {
  private embeddings: Embeddings;

  constructor(
    @inject(MEMORY_SERVICE_CONFIG) config: MemoryServiceConfig
  ) {
    this.embeddings = new OpenAIEmbeddings({
      modelName: config.embeddingConfig.model || "text-embedding-ada-002",
      openAIApiKey: config.embeddingConfig.apiKey,
      configuration: { baseURL: config.embeddingConfig.baseURL }
    });
  }
}
```

### 修改后（依赖注入 EmbeddingService）

```typescript
export interface MemoryServiceConfig {
  userId: string;
  dbPath: string;
  maxMemoryAgeDays?: number;
}

@transient()
export class MemoryService {
  constructor(
    @inject(MEMORY_SERVICE_CONFIG) config: MemoryServiceConfig,
    @inject(IEmbeddingService) private embeddings: IEmbeddingService,
    @inject(ImportanceEvaluator, { optional: true }) private importanceEvaluator?: ImportanceEvaluator,
    @inject(MemoryCompressor, { optional: true }) private memoryCompressor?: MemoryCompressor
  ) {
    // ...
  }
}
```

### UserServiceBase 注册示例

```typescript
const container = new Container();
const modelConfig = config.getCurrentModel()!;

// 创建 embedding 服务
const embeddingFactory = new EmbeddingServiceFactory();
container.registerInstance(IEmbeddingService, await embeddingFactory.getEmbeddingService({
  apiKey: modelConfig.apiKey,
  baseURL: modelConfig.baseURL,
  model: "text-embedding-ada-002"
}));

// 注册记忆服务配置
container.registerInstance(MEMORY_SERVICE_CONFIG, {
  userId: this.userId,
  dbPath: config.getConfigPath(`memory/${this.userId}.db`),
  maxMemoryAgeDays: 90
});

// MemoryService 会通过 @transient() 自动解析并注入 IEmbeddingService
const agentService = await container.resolve(AgentService);
```

## 优势

### 1. 职责分离
- MemoryService 不再负责创建和配置 embedding 实例
- 配置简化，只关注业务逻辑相关的配置

### 2. 可测试性
```typescript
// 可以轻松 mock IEmbeddingService 进行测试
class MockEmbeddingService extends IEmbeddingService {
  async embedQuery(text: string): Promise<number[]> {
    return [0.1, 0.2, 0.3]; // 固定的测试向量
  }
  // ...
}

container.registerInstance(IEmbeddingService, new MockEmbeddingService());
```

### 3. 扩展性
- 可以轻松添加新的 embedding 提供商（Cohere, HuggingFace 等）
- 通过工厂模式统一管理

```typescript
class CohereEmbeddingService extends IEmbeddingService {
  // Cohere 的实现
}

// 工厂中添加 provider 判断
private async createEmbeddingService(config: EmbeddingConfig): Promise<IEmbeddingService> {
  switch (config.provider) {
    case "openai":
      return new OpenAIEmbeddingService(config);
    case "cohere":
      return new CohereEmbeddingService(config);
    default:
      throw new Error(`不支持的 provider: ${config.provider}`);
  }
}
```

### 4. 资源管理
- 工厂类提供缓存机制，避免重复创建相同配置的实例
- 统一的 cleanup 接口用于资源释放

### 5. 类型安全
- 使用 Symbol token (`EMBEDDING_CONFIG`) 替代字符串
- 编译时检查，避免运行时错误

## API 接口

### IEmbeddingService

```typescript
abstract class IEmbeddingService {
  abstract embedQuery(text: string): Promise<number[]>;
  abstract embedDocuments(texts: string[]): Promise<number[][]>;
  abstract initialize(): Promise<void>;
  abstract cleanup(): Promise<void>;
}
```

### EmbeddingServiceFactory

```typescript
class EmbeddingServiceFactory {
  async getEmbeddingService(config: EmbeddingConfig): Promise<IEmbeddingService>;
  async clearCache(): Promise<void>;
  hasCached(config: EmbeddingConfig): boolean;
  getCacheSize(): number;
}
```

### EmbeddingConfig

```typescript
interface EmbeddingConfig {
  apiKey: string;
  baseURL?: string;
  model?: string;
}
```

## 缓存策略

缓存键由 `baseURL` 和 `model` 组成：

```typescript
private getCacheKey(config: EmbeddingConfig): string {
  return `${config.baseURL || "default"}:${config.model || "text-embedding-ada-002"}`;
}
```

这意味着：
- 相同的 baseURL + model 会复用同一个实例
- 不同的 apiKey 但相同的 baseURL + model 也会复用（注意：这可能需要根据实际需求调整）

## 最佳实践

1. **使用工厂创建实例**：不要直接 `new OpenAIEmbeddingService()`
2. **通过 DI 注入使用**：在服务中通过 `@inject(IEmbeddingService)` 注入
3. **及时清理资源**：应用关闭时调用 `factory.clearCache()`
4. **配置集中管理**：embedding 配置应该从统一的配置源获取

## 与 ModelService 的对比

| 特性 | ModelService | EmbeddingService |
|-----|-------------|-----------------|
| 抽象接口 | IModelService | IEmbeddingService |
| 工厂类 | ModelServiceFactory | EmbeddingServiceFactory |
| 配置来源 | config.getModel(name) | 手动传入 EmbeddingConfig |
| 缓存键 | modelName | baseURL + model |
| 主要方法 | invoke, stream, bindTools | embedQuery, embedDocuments |

## 未来改进方向

1. **配置统一管理**：考虑将 embedding 配置也加入全局配置系统
2. **多提供商支持**：添加 Cohere, HuggingFace 等提供商
3. **批量优化**：优化大规模文本的批量处理
4. **错误重试**：添加自动重试机制
5. **性能监控**：添加性能指标收集
