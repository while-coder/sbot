# Embedding 配置指南

## 概述

在 SBot 中，embedding 配置现在已经集成到统一的配置系统中，参考了 models 的配置格式。您可以在 `~/.sbot/settings.toml` 中配置多个 embedding 服务，并通过 `embedding` 字段切换使用哪一个。

## 配置文件结构

### 基本配置

```toml
# SBot 配置文件 (~/.sbot/settings.toml)

# 当前使用的 embedding 名称
embedding = "openai-ada"

# Embedding 配置
[embeddings.openai-ada]
provider = "openai"
apiKey = "sk-xxx"
baseURL = "https://api.openai.com/v1"
model = "text-embedding-ada-002"
```

### 多 Embedding 配置

您可以配置多个 embedding 服务，通过修改 `embedding` 字段来切换：

```toml
# 当前使用的 embedding
embedding = "openai-3-small"

# OpenAI Ada-002（最便宜，性能稳定）
[embeddings.openai-ada]
provider = "openai"
apiKey = "sk-xxx"
baseURL = "https://api.openai.com/v1"
model = "text-embedding-ada-002"

# OpenAI Embedding 3 Small（性能更好，维度更高）
[embeddings.openai-3-small]
provider = "openai"
apiKey = "sk-xxx"
baseURL = "https://api.openai.com/v1"
model = "text-embedding-3-small"

# OpenAI Embedding 3 Large（最高性能）
[embeddings.openai-3-large]
provider = "openai"
apiKey = "sk-xxx"
baseURL = "https://api.openai.com/v1"
model = "text-embedding-3-large"

# Azure OpenAI Embedding
[embeddings.azure-ada]
provider = "azure"
apiKey = "your-azure-key"
baseURL = "https://your-resource.openai.azure.com"
model = "text-embedding-ada-002"
```

## 配置字段说明

| 字段 | 必需 | 说明 | 示例 |
|-----|------|-----|------|
| `provider` | 否 | 服务提供商 | `"openai"`, `"azure"` |
| `apiKey` | 是 | API 密钥 | `"sk-xxx"` |
| `baseURL` | 是 | API 基础 URL | `"https://api.openai.com/v1"` |
| `model` | 是 | 模型名称 | `"text-embedding-ada-002"` |

## 在代码中使用

### 1. 获取当前 Embedding 配置

```typescript
import { config } from "./Config";

// 获取当前选中的 embedding 名称
const embeddingName = config.getEmbeddingName();
console.log(embeddingName); // "openai-ada"

// 获取当前 embedding 配置
const embeddingConfig = config.getCurrentEmbedding();
if (embeddingConfig) {
  console.log(embeddingConfig.provider); // "openai"
  console.log(embeddingConfig.model);    // "text-embedding-ada-002"
}
```

### 2. 获取指定的 Embedding 配置

```typescript
// 获取特定名称的 embedding 配置
const ada = config.getEmbedding("openai-ada");
const small = config.getEmbedding("openai-3-small");
const large = config.getEmbedding("openai-3-large");
```

### 3. 使用配置创建 Embedding 服务

```typescript
import { config } from "./Config";
import { EmbeddingServiceFactory } from "./Embedding";

const factory = new EmbeddingServiceFactory();

// 使用当前配置
const embeddingConfig = config.getCurrentEmbedding();
const embeddingService = await factory.getEmbeddingService(embeddingConfig);

// 生成 embedding
const embedding = await embeddingService.embedQuery("Hello world");
console.log(embedding.length); // 1536 (ada-002) 或其他维度
```

### 4. 在依赖注入中使用

```typescript
import { Container } from "./Core";
import { IEmbeddingService, EmbeddingServiceFactory } from "./Embedding";
import { config } from "./Config";

const container = new Container();

// 从配置获取 embedding 服务
const embeddingConfig = config.getCurrentEmbedding();
if (embeddingConfig) {
  const factory = new EmbeddingServiceFactory();
  const embeddingService = await factory.getEmbeddingService(embeddingConfig);
  container.registerInstance(IEmbeddingService, embeddingService);
}

// 在其他服务中注入使用
@transient()
class MemoryService {
  constructor(
    @inject(IEmbeddingService) private embeddings: IEmbeddingService
  ) {}
}
```

## API 参考

### Config 类方法

```typescript
class Config {
  // 获取当前 embedding 名称
  getEmbeddingName(): string;

  // 获取指定名称的 embedding 配置
  getEmbedding(name?: string): EmbeddingConfig | undefined;

  // 获取当前 embedding 配置
  getCurrentEmbedding(): EmbeddingConfig | undefined;
}
```

### EmbeddingConfig 接口

```typescript
interface EmbeddingConfig {
  provider?: string;
  apiKey?: string;
  baseURL?: string;
  model?: string;
}
```

## 常见 Embedding 模型

### OpenAI

| 模型 | 维度 | 价格 | 适用场景 |
|-----|------|------|---------|
| `text-embedding-ada-002` | 1536 | 最低 | 通用场景，性价比高 |
| `text-embedding-3-small` | 1536 | 低 | 性能更好，维度可调 |
| `text-embedding-3-large` | 3072 | 中 | 最高性能，高精度 |

### Azure OpenAI

与 OpenAI 相同的模型，但需要配置 Azure 特定的 baseURL：

```toml
[embeddings.azure-ada]
provider = "azure"
apiKey = "your-azure-key"
baseURL = "https://your-resource.openai.azure.com"
model = "text-embedding-ada-002"
```

## 配置示例场景

### 场景 1: 开发环境使用便宜的模型

```toml
# 开发环境配置
embedding = "openai-ada"

[embeddings.openai-ada]
provider = "openai"
apiKey = "sk-dev-xxx"
baseURL = "https://api.openai.com/v1"
model = "text-embedding-ada-002"
```

### 场景 2: 生产环境使用高性能模型

```toml
# 生产环境配置
embedding = "openai-3-large"

[embeddings.openai-3-large]
provider = "openai"
apiKey = "sk-prod-xxx"
baseURL = "https://api.openai.com/v1"
model = "text-embedding-3-large"
```

### 场景 3: 使用 Azure OpenAI

```toml
# Azure 环境配置
embedding = "azure-production"

[embeddings.azure-production]
provider = "azure"
apiKey = "azure-key-xxx"
baseURL = "https://your-company.openai.azure.com"
model = "text-embedding-ada-002"
```

## 切换 Embedding 模型

要切换使用不同的 embedding 模型，只需修改配置文件顶部的 `embedding` 字段：

```toml
# 从 ada-002 切换到 3-small
# embedding = "openai-ada"  # 注释掉旧配置
embedding = "openai-3-small"  # 使用新配置
```

然后重启应用即可。

## 与 Memory 系统的集成

MemoryService 会自动使用配置的 embedding 服务：

```typescript
// UserServiceBase.ts 中的实现
const embeddingConfig = config.getCurrentEmbedding();
if (embeddingConfig && embeddingConfig.apiKey && embeddingConfig.baseURL) {
  // 创建 embedding 服务
  const embeddingFactory = new EmbeddingServiceFactory();
  container.registerInstance(
    IEmbeddingService,
    await embeddingFactory.getEmbeddingService(embeddingConfig)
  );

  // MemoryService 会自动注入 IEmbeddingService
}
```

## 最佳实践

1. **分离 API 密钥**：为不同环境使用不同的 API 密钥
2. **根据场景选择模型**：
   - 原型开发：使用 `text-embedding-ada-002`（便宜）
   - 生产环境：使用 `text-embedding-3-small` 或 `3-large`（高性能）
3. **使用配置管理**：不要在代码中硬编码 embedding 配置
4. **监控成本**：定期检查 embedding API 的使用量和成本
5. **缓存 embeddings**：对于相同的文本，可以缓存 embedding 结果避免重复调用

## 故障排查

### 问题 1: 未找到 embedding 配置

**错误信息**：
```
未找到 embedding 配置
```

**解决方案**：
1. 检查 `~/.sbot/settings.toml` 是否存在
2. 确认配置了 `embedding` 字段
3. 确认对应的 `[embeddings.xxx]` 配置存在

### 问题 2: API 密钥无效

**错误信息**：
```
Embedding 配置缺少 apiKey
```

**解决方案**：
1. 检查 `apiKey` 字段是否填写
2. 确认 API 密钥有效且未过期
3. 检查 API 密钥的权限（需要 embeddings 权限）

### 问题 3: baseURL 错误

**错误信息**：
```
Failed to fetch embedding
```

**解决方案**：
1. 检查 `baseURL` 格式是否正确
2. Azure 用户确认资源名称和区域
3. 测试网络连接是否正常

## 更多示例

参考示例文件：
- [examples/EmbeddingServiceExample.ts](../examples/EmbeddingServiceExample.ts) - EmbeddingService 基础用法
- [examples/EmbeddingConfigExample.ts](../examples/EmbeddingConfigExample.ts) - 配置系统使用示例

## 相关文档

- [EmbeddingService.md](./EmbeddingService.md) - EmbeddingService 架构设计
- [Config.md](./Config.md) - 配置系统总览
