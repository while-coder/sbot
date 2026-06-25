export { WikiPlugin, WikiPluginContext, defineWikiPlugin } from "./WikiPlugin";

// 重导出第三方实现 wiki 插件所需的契约，使其只依赖 wiki.base 即可。
export { ConfigField, ConfigFieldType } from "sbot.plugin";
export type { IWikiDatabase, WikiPage } from "scorpio.ai";
