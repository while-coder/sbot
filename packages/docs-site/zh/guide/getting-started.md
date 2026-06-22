# 快速开始

## 通过 npm 安装

```bash
# 安装
npm install -g @qingfeng346/sbot

# 启动（前台），随后访问 http://localhost:5500
sbot

# 后台启动（关闭终端不退出）
sbot -d

# 指定端口启动（5500 被占用时使用，-p 与 -d 可组合）
sbot -p 3000
sbot -d -p 3000

# 仅保存端口，不启动服务
sbot port 3000
```

### 命令参考

| 命令 | 说明 |
|---------|-------------|
| `sbot` | 启动服务（前台） |
| `sbot -d` / `--daemon` | 后台启动（关闭终端不退出） |
| `sbot -p <port>` / `--port` | 指定端口启动，如 `sbot -p 3000` |
| `sbot port <port>` | 仅修改并保存端口，不启动服务 |
| `sbot stop` | 关闭正在运行的服务 |
| `sbot status` | 查看运行状态、端口、自启动、版本、配置目录 |
| `sbot -v` / `--version` | 查看版本并检查更新 |
| `sbot startup enable` | 开启开机自启动 |
| `sbot startup disable` | 取消开机自启动 |
| `sbot startup status` | 查看开机自启动状态 |

### macOS 上的权限错误（EACCES）？

如果 `npm install -g` 报 `EACCES: permission denied`，**不建议用 `sudo` 强行安装** —— 之后很容易出现各种文件归属混乱。推荐做法是让 npm 指向用户目录下的全局包目录。

```bash
mkdir -p ~/.npm-global && \
npm config set prefix '~/.npm-global' && \
RC_FILE=$([ "${SHELL##*/}" = "bash" ] && echo ~/.bash_profile || echo ~/.zshrc) && \
grep -q '.npm-global/bin' "$RC_FILE" 2>/dev/null || echo 'export PATH=~/.npm-global/bin:$PATH' >> "$RC_FILE" && \
source "$RC_FILE" && \
echo "完成，现在可以执行: npm install -g @qingfeng346/sbot"
```

完成后重新执行 `npm install -g @qingfeng346/sbot` 即可。

## 通过 Docker 安装

```bash
docker pull qingfeng346/sbot
docker run -d \
  -p 5500:5500 \
  -v ~/.sbot:/root/.sbot \
  --name sbot \
  qingfeng346/sbot
# 打开 http://localhost:5500
```

配置和数据持久化在宿主机的 `~/.sbot` 目录下。

### Docker Compose

适合长期运行、希望版本受控、便于一键升级的场景。新建 `docker-compose.yml`：

```yaml
services:
  sbot:
    image: qingfeng346/sbot
    container_name: sbot
    ports:
      - "5500:5500"
    volumes:
      - ~/.sbot:/root/.sbot
    environment:
      - TZ=Asia/Shanghai
      - LOG_LEVEL=INFO
    restart: unless-stopped
```

常用命令：

```bash
docker compose up -d            # 后台启动
docker compose logs -f          # 查看日志
docker compose down             # 停止并移除容器（数据保留在 ~/.sbot）
docker compose pull && docker compose up -d   # 升级到最新镜像
```

## 第一步操作

启动 sbot 后打开 `http://localhost:5500`，按以下顺序操作：

1. **添加模型** —— 侧栏 → **语言模型** → 新建。详见 [模型](./models)
2. **创建 Saver** —— 侧栏 → **对话存储** → 新建。详见 [Savers](./savers)
3. **创建 Agent** —— 侧栏 → **Agent 管理** → 新建。详见 [Agents](./agents)
4. **开始对话** —— 侧栏 → **聊天** → 新建会话

可选的下一步：

- **接入渠道** —— 侧栏 → **渠道**，支持飞书 / Slack / 企业微信 / 微信 / 钉钉 / QQ / OneBot / 小爱。详见 [渠道](./channels)
- **启用 Wiki** —— 长期知识库。详见 [Wiki](./wiki)
- **启用 Notes** —— 向量召回式记忆。详见 [Notes](./note)
- **启用 Memory** —— 由后台 MemoryLLM 自动提取的长期记忆。详见 [Memory](./memory)
- **启用 Agenda** —— 由对话驱动的提醒 / 日程。详见 [Agenda](./agenda)
- **安装预制 Agent** —— 侧栏 → **Agent 商店**。详见 [Agent 商店](./agent-store)
