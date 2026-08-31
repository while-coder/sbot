import { defineWikiPlugin, ConfigFieldType } from "wiki.base";
import { WikiDriveDatabase } from "./WikiDriveDatabase";

/**
 * Google Drive wiki 数据源插件。把一个 Drive 文件夹当作只读 wiki 目录：
 * 列文件清单 = 目录，wiki_read 拉单文件全文（原生 Docs/Sheets/Slides 导出为 Markdown/CSV/文本）。
 *
 * 本插件作为内置数据源随 sbot 打包，在后台 Wiki 配置里选择数据源
 * "Google Drive" 并填写 Folder ID 与服务账号凭据即可。
 */
export const gdrivePlugin = defineWikiPlugin({
  type: "gdrive",
  label: "Google Drive",
  readOnly: true,
  configSchema: {
    folderId: {
      label: "Folder ID",
      type: ConfigFieldType.String,
      required: true,
      description: "作为 wiki 目录的 Google Drive 文件夹 ID（URL 中 /folders/ 之后那段）",
    },
    auth: {
      label: "Auth JSON",
      type: ConfigFieldType.Textarea,
      required: true,
      description: "服务账号凭据 JSON 内容。需把目标文件夹共享给该服务账号邮箱（查看者即可）。",
    },
  },
  async init(ctx) {
    return new WikiDriveDatabase(ctx.config, ctx.logger, ctx.cachePath);
  },
});
