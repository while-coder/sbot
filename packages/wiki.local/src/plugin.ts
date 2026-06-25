import { defineWikiPlugin } from "wiki.base";
import { WikiFileDatabase } from "./WikiFileDatabase";

/**
 * 本地文件 wiki 数据源（第一方内置插件）。读写 config/wiki/{wikiId}/*.md，
 * 是 wiki 的缺省数据源（WikiConfig 不指定 type，或 type='local'）。
 */
export const localPlugin = defineWikiPlugin({
  type: "local",
  label: "本地文件",
  configSchema: {},
  async init(ctx) {
    return new WikiFileDatabase(ctx.cachePath);
  },
});
