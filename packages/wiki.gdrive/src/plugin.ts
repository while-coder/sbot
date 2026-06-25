import { defineWikiPlugin, ConfigFieldType } from "wiki.base";
import { WikiDriveDatabase } from "./WikiDriveDatabase";

/**
 * Google Drive wiki 数据源插件。把一个 Drive 文件夹当作只读 wiki 目录：
 * 列文件清单 = 目录，wiki_read 拉单文件全文（原生 Docs/Sheets/Slides 导出为 Markdown/CSV/文本）。
 *
 * 用户安装本包后，把 "wiki.gdrive" 加入 settings.plugins 即被加载，
 * 然后在后台 Wiki 配置里选择数据源 "Google Drive" 并填写认证信息。
 */
export const gdrivePlugin = defineWikiPlugin({
  type: "gdrive",
  label: "Google Drive",
  readOnly: true,
  configSchema: {
    authMethod: {
      label: "认证方式",
      type: ConfigFieldType.Select,
      required: true,
      default: "service_account",
      options: [
        { label: "Service Account", value: "service_account" },
        { label: "OAuth", value: "oauth" },
      ],
    },
    folderId: {
      label: "Folder ID",
      type: ConfigFieldType.String,
      required: true,
      description: "作为 wiki 目录的 Google Drive 文件夹 ID（URL 中 /folders/ 之后那段）",
    },
    credentials: {
      label: "Service Account JSON",
      type: ConfigFieldType.Password,
      description: "Service Account 模式：服务账号凭据 JSON。需把目标文件夹共享给该服务账号邮箱（查看者即可）。",
      showWhen: { field: "authMethod", eq: "service_account" },
    },
    clientId: {
      label: "OAuth Client ID",
      type: ConfigFieldType.String,
      description: "OAuth 模式：OAuth 2.0 客户端 ID。",
      showWhen: { field: "authMethod", eq: "oauth" },
    },
    clientSecret: {
      label: "OAuth Client Secret",
      type: ConfigFieldType.Password,
      description: "OAuth 模式：OAuth 2.0 客户端密钥。",
      showWhen: { field: "authMethod", eq: "oauth" },
    },
    refreshToken: {
      label: "OAuth Refresh Token",
      type: ConfigFieldType.Password,
      description: "OAuth 模式：预先获取的 refresh token（drive.readonly 作用域）。",
      showWhen: { field: "authMethod", eq: "oauth" },
    },
  },
  async init(ctx) {
    return new WikiDriveDatabase(ctx.config, ctx.logger, ctx.cachePath);
  },
});
