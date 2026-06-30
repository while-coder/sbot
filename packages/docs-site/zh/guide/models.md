# 模型

侧栏 → **语言模型** → 新建

填写 provider、API Key、Base URL 和模型名。同一个模型连接可被多个 Agent 复用。

## 支持的供应商

| 供应商 | 备注 |
|----------|-------|
| OpenAI | OpenAI Chat Completions 兼容模型 |
| OpenAI Responses | OpenAI Responses API 模型 |
| Anthropic | Claude 4.x、3.x 系列 |
| Google Gemini | Gemini 2.0 / 2.5 Pro、Flash |
| Gemini Image | Gemini 图像生成模型 |
| Ollama | 通过 Ollama 运行时使用本地模型 |
| OpenAI 兼容 | Azure OpenAI、Groq、Mistral、DeepSeek、Qwen、Together 等 |

任何实现了 OpenAI Chat Completions 接口的服务都可以作为供应商使用 —— 选择 **OpenAI 兼容** 并覆盖 Base URL 即可。

## 稳定性

- 网络抖动（5xx、网络异常、限流）时自动指数退避重试
- 可选模型响应缓存，重复相同提示时显示命中 / 未命中指标
- **Token 用量** 页面按模型统计消耗

## 高级选项

- **上下文窗口 / 最大输出 token** —— 当供应商没有明确返回限制时，可手动覆盖
- **最大工具数** —— 限制每轮发送给模型的工具数量
- **Anthropic thinking** —— 可选择不开启、自适应或始终开启，并配置预算
- **Anthropic Prompt Cache** —— 启用供应商侧 Prompt 缓存提示
- **Gemini API Version** —— 需要时覆盖 Gemini API 版本

## 向量模型（Embedding）

侧栏 → **向量模型** → 新建

向量模型是基于向量的功能（[Notes](./note)、[Wiki](./wiki) 语义检索、[Memory](./memory) 混合检索）的前置依赖。支持：OpenAI、Gemini、Ollama、Cohere、VoyageAI。
