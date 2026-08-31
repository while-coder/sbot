# wiki.gdrive

把一个 Google Drive 文件夹当作 sbot 的**只读** wiki 数据源：文件夹里的文件列表 = wiki 目录，
`wiki_read` 拉取单个文件全文。Google 原生文档会被导出为文本/Markdown：

| 文件类型 | 读取方式 |
|---|---|
| Google 文档 (Docs) | 导出为 Markdown |
| Google 表格 (Sheets) | 导出为 CSV |
| Google 幻灯片 (Slides) | 导出为纯文本 |
| `.md` / `.txt` / `.json` 等文本文件 | 直接读取原文 |
| 其它二进制文件 | 返回"不可读"提示 |

> 只读：不支持在 sbot 内新增/编辑/删除页面，后台查看器会隐藏这些操作。

## 启用

本插件已作为**内置数据源**随 sbot 一起打包，无需单独安装。直接进入后台
**Wiki 配置** → 新建知识库 → 数据源下拉选择 **Google Drive**，按下方说明填写认证信息即可。

> 它是第一方插件，因此默认出现在数据源下拉里（与 channel.lark 等内置渠道同等待遇）。
> 第三方自研的 wiki 数据源插件则走 `settings.plugins` 或 `~/.sbot/plugins/` 本地目录加载。

## 配置项

| 字段 | 说明 |
|---|---|
| Folder ID | 作为 wiki 目录的 Drive 文件夹 ID（见下） |
| Auth JSON | 服务账号凭据 JSON 内容（见下） |

### 怎么拿 Folder ID

在浏览器打开目标文件夹，地址栏形如：

```
https://drive.google.com/drive/folders/1A2b3C4d5E6f7G8h9I0jKlMnOpQr
                                        └────────── Folder ID ──────────┘
```

`/folders/` 之后那一段就是 Folder ID。

---

## 认证：Service Account

服务账号是一个"机器人"身份，你把目标文件夹共享给它的邮箱即可，无需任何交互式登录。

1. **创建/选择项目**
   打开 [Google Cloud Console](https://console.cloud.google.com/)，新建或选择一个项目。

2. **启用 Drive API**
   导航到 **APIs & Services → Library**，搜索 **Google Drive API**，点击 **Enable**。

3. **创建服务账号**
   **APIs & Services → Credentials → Create Credentials → Service account**。
   填写名称后创建，角色可留空（只读 Drive 不需要项目级角色）。

4. **生成 JSON 密钥**
   进入刚创建的服务账号 → **Keys → Add Key → Create new key → JSON**，
   下载得到的 JSON 文件，**完整内容**（含 `client_email`、`private_key` 等）即填入
   "Auth JSON" 字段。

5. **把文件夹共享给服务账号**
   复制 JSON 里的 `client_email`（形如 `xxx@xxx.iam.gserviceaccount.com`），
   回到 Google Drive，对目标文件夹点击 **共享**，把该邮箱加为**查看者 (Viewer)** 即可。

   > 不共享的话，服务账号看不到任何文件，列目录会是空的。

> **共享盘 (Shared Drive)**：把服务账号加为共享盘成员同样可用，插件已开启
> `supportsAllDrives` / `includeItemsFromAllDrives`。

---

## 行为说明

- **懒加载**：列目录只取文件名等元数据，不下载内容；`wiki_read` 命中某个文件时才真正拉全文，
  搜索仅按标题（文件名）匹配。
- **缓存**：文件清单缓存 60s、单文件内容缓存 5min，按 Folder ID 隔离，降低 Drive API 调用与配额压力。
- **作用域**：授权 scope 为 `https://www.googleapis.com/auth/drive`，但插件本身只做读取，
  不会修改你的任何文件。
