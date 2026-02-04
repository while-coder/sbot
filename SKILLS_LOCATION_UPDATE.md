# Skills 目录位置更新说明

## 更新内容

Skills 目录已从项目根目录移动到配置目录下。

## 新的位置

### Linux/Mac
```
~/.sbot/skills/
```

### Windows
```
C:\Users\{用户名}\.sbot\skills\
```

## 为什么要这样做？

1. **多项目共享**: 不同项目可以共享同一套 skills，无需重复创建
2. **用户级配置**: Skills 作为用户级配置，更符合应用设计
3. **持久化**: 即使删除项目，skills 依然保留
4. **统一管理**: 与其他配置文件（settings.toml）放在同一位置

## 代码变更

### AgentService 构造函数
```typescript
// 之前
constructor(userId: string, skillsDir?: string) {
    this.threadId = userId;
    this.skillsDir = skillsDir || path.join(process.cwd(), "skills");
}

// 现在
constructor(userId: string, skillsDir?: string) {
    this.threadId = userId;
    // 使用配置目录
    this.skillsDir = skillsDir || config.getConfigPath("skills", true);
}
```

### 自动创建目录

使用 `config.getConfigPath("skills", true)` 时，如果目录不存在会自动创建。

## 如何使用

### 1. 查看 Skills 目录

运行测试脚本会显示 skills 目录位置：

```bash
node test-skills.js
```

输出示例：
```
Skills directory: C:\Users\while\.sbot\skills
Loading skills from config directory...
✓ Successfully loaded 1 skill(s)
```

### 2. 创建新 Skill

```bash
# Linux/Mac
cd ~/.sbot/skills
mkdir my-skill
nano my-skill/SKILL.md

# Windows (PowerShell)
cd $env:USERPROFILE\.sbot\skills
mkdir my-skill
notepad my-skill\SKILL.md
```

### 3. Skills 结构示例

```
~/.sbot/skills/           # 配置目录下的 skills
├── example-skill/        # 示例 skill
│   ├── SKILL.md
│   ├── scripts/
│   ├── references/
│   └── assets/
└── my-skill/            # 你的自定义 skill
    └── SKILL.md
```

## 迁移现有 Skills

如果你已经在项目根目录创建了 skills：

```bash
# Linux/Mac
cp -r ./skills/* ~/.sbot/skills/

# Windows (PowerShell)
Copy-Item -Recurse .\skills\* $env:USERPROFILE\.sbot\skills\
```

或者手动复制：
1. 打开项目根目录的 `skills/` 文件夹
2. 复制所有 skill 子文件夹
3. 粘贴到 `~/.sbot/skills/` 或 `C:\Users\{用户名}\.sbot\skills\`

## 验证

运行测试脚本验证 skills 是否正确加载：

```bash
npm run build
node test-skills.js
```

应该看到：
```
✓ Successfully loaded N skill(s)

Loaded Skills:
------------------------------------------------------------
1. example-skill
   Description: ...
   Path: C:\Users\{用户名}\.sbot\skills\example-skill
   ...
```

## 注意事项

1. **首次运行**: 配置目录和 skills 文件夹会自动创建
2. **example-skill**: 已经复制到配置目录，可以作为参考
3. **项目 skills 文件夹**: 项目根目录的 `skills/` 文件夹现在仅作为文档和示例参考

## 文件更新清单

- [x] `src/Agent/AgentService.ts` - 修改构造函数使用 `config.getConfigPath()`
- [x] `test-skills.js` - 更新为从配置目录加载
- [x] `skills/README.md` - 添加位置说明
- [x] 复制 skills 到 `~/.sbot/skills/`
- [x] 创建此更新说明文档

## 相关文档

- [SKILLS_GUIDE.md](./SKILLS_GUIDE.md) - 完整使用指南
- [skills/README.md](./skills/README.md) - Skills 快速入门
- [IMPLEMENTATION_NOTES.md](./IMPLEMENTATION_NOTES.md) - 技术实现说明

---

**更新日期**: 2026-02-04
