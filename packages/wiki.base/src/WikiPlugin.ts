import type { IWikiDatabase, IEmbeddingService } from "scorpio.ai";
import type { ConfigField } from "sbot.plugin";

/**
 * 宿主在创建某个 wiki 数据源实例时注入的上下文。
 */
export interface WikiPluginContext {
  /** 该 wiki 的配置（admin 表单按 configSchema 填写的值）。 */
  config: Record<string, any>;
  /** 宿主 logger。 */
  logger: any;
  /** 宿主为该 wiki 分配的本地缓存目录（= config/wiki/{wikiId}）。 */
  cachePath: string;
  /** 宿主已解析好的可选 embedding（用户在 WikiConfig.embedding 指定时注入）。 */
  embedding?: IEmbeddingService;
}

/**
 * Wiki 数据源插件契约。第三方实现并导出一个 WikiPlugin 对象即可扩展新的 wiki 来源
 * （本地文件、Google Drive、Notion 等）。`init()` 返回的对象即注入 WikiService 的
 * IWikiDatabase —— 复用现有存储接口，核心服务无需改动。
 */
export interface WikiPlugin {
  /** 区分插件种类，供统一加载器分流（与 ChannelPlugin 区别开）。 */
  kind: "wiki";
  /** 数据源类型标识，全局唯一，对应 WikiConfig.type。 */
  type: string;
  /** 显示名（admin 下拉用）。 */
  label: string;
  /** 配置项 schema，驱动 admin 表单渲染。 */
  configSchema: Record<string, ConfigField>;
  /** 只读源（如 Drive）标记 true → admin 隐藏新增/编辑/删除入口。 */
  readOnly?: boolean;
  /** 创建数据源实例。返回的对象即注入 WikiService 的 IWikiDatabase。 */
  init(ctx: WikiPluginContext): Promise<IWikiDatabase>;
  /** 可选清理钩子。 */
  dispose?(): Promise<void>;
}

/**
 * 声明一个 wiki 数据源插件。自动注入 `kind: "wiki"`，各插件无需手写判别字段。
 * 类型上要求除 kind 外的所有字段，漏写/拼错照常报错。
 */
export function defineWikiPlugin(plugin: Omit<WikiPlugin, "kind">): WikiPlugin {
  return { ...plugin, kind: "wiki" };
}
