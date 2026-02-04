# Skills 系统使用指南

本指南介绍如何在 sbot 项目中使用和创建 Skills。

## 目录
- [什么是 Skills](#什么是-skills)
- [Skills 系统架构](#skills-系统架构)
- [如何使用 Skills](#如何使用-skills)
- [如何创建 Skill](#如何创建-skill)
- [Skill 规范](#skill-规范)
- [示例](#示例)
- [测试](#测试)

---

## 什么是 Skills

Skills 是为特定任务优化工作流的自包含模块。每个 Skill 包含：
- **SKILL.md** - 必需的主文件，包含元数据（YAML frontmatter）和详细指南
- **scripts/** - 可选的可执行脚本（Python、Shell、Node.js 等）
- **references/** - 可选的参考文档
- **assets/** - 可选的资源文件（模板、配置等）

Skills 的设计参考了 [mini-opencode](https://github.com/anthropics/mini-opencode) 项目，采用**渐进式加载模式**：
1. Agent 始终知道所有可用的 skills（通过元数据）
2. 当需要时，Agent 读取 SKILL.md 获取详细指南
3. 根据需要访问 scripts、references 或 assets

---

## Skills 系统架构

### 目录结构
```
sbot/
├── src/
│   └── Skills/              # Skills 系统源代码
│       ├── types.ts         # Skill 类型定义
│       ├── parser.ts        # SKILL.md 解析器
│       ├── loader.ts        # Skills 批量加载器
│       └── index.ts         # 模块导出
├── skills/                  # Skills 存放目录
│   ├── README.md           # Skills 使用说明
│   └── example-skill/      # 示例 Skill
│       ├── SKILL.md        # Skill 主文件
│       ├── scripts/        # 可执行脚本
│       ├── references/     # 参考文档
│       └── assets/         # 资源文件
└── test-skills.js          # Skills 系统测试脚本
```

### 核心组件

| 文件 | 功能 |
|------|------|
| `src/Skills/types.ts` | 定义 Skill 和 SkillMetadata 接口 |
| `src/Skills/parser.ts` | 解析 SKILL.md，验证 YAML frontmatter |
| `src/Skills/loader.ts` | 从 skills/ 目录加载所有 skills |
| `src/Agent/AgentService.ts` | 集成 skills，注入到系统提示词 |

### 数据流
```
启动 AgentService
    ↓
loadSkillsIfNeeded()
    ↓
loadSkills(skillsDir)
    ↓
遍历 skills/ 目录
    ↓
parseSkill() 解析每个 SKILL.md
    ↓
生成 skills 列表
    ↓
注入到系统提示词
    ↓
Agent 可以使用 skills
```

---

## 如何使用 Skills

### 对于 AI Agent

当 Agent 收到用户请求时，会自动：
1. **识别** - 判断是否有合适的 skill 可以处理该任务
2. **告知** - 告诉用户将使用某个 skill
3. **理解** - 从 skills 列表中了解基本信息
4. **访问** - 如需详细信息，读取对应的 SKILL.md 或其他文件
5. **执行** - 按照 skill 的指导完成任务

### 系统提示词中的 Skills

Skills 信息会自动注入到系统提示词中：

```
<skill_system>
你可以访问为特定任务优化工作流的 skills。

**渐进式加载模式**:
1. 当用户查询与 skill 用例匹配时，识别相关的 skill
2. 告知用户你将使用该 skill 来处理任务
3. 理解 skill 的工作流和指导（skill 信息已在下方列表中）
...

<all_available_skills>
- example-skill: /path/to/skills/example-skill
  这是一个示例 skill，展示如何创建和组织 skill 的结构...
</all_available_skills>

</skill_system>
```

---

## 如何创建 Skill

### 步骤 1: 创建目录

```bash
cd skills
mkdir my-awesome-skill
cd my-awesome-skill
```

### 步骤 2: 创建 SKILL.md

创建 `SKILL.md` 文件，包含 YAML frontmatter 和 Markdown 内容：

```markdown
---
name: my-awesome-skill
description: 这个 skill 可以做某某事情。当用户需要某某功能时使用。
license: MIT
---

# My Awesome Skill

这个 skill 的详细使用指南...

## 何时使用

当用户需要...时使用此 skill。

## 工作流程

1. 第一步...
2. 第二步...
3. 第三步...

## 示例

...
```

### 步骤 3: 添加可选组件

根据需要创建子目录：

```bash
# 添加脚本
mkdir scripts
echo "#!/usr/bin/env python3" > scripts/helper.py

# 添加参考文档
mkdir references
echo "# API Documentation" > references/api.md

# 添加资源文件
mkdir assets
cp template.json assets/
```

### 步骤 4: 测试

重启应用或运行测试脚本：

```bash
node test-skills.js
```

---

## Skill 规范

### YAML Frontmatter 必需字段

```yaml
---
name: skill-name              # 必需
description: Skill 描述        # 必需
---
```

### YAML Frontmatter 可选字段

```yaml
---
name: skill-name
description: Skill 描述
license: MIT                  # 可选：许可证
allowed-tools:                # 可选：允许的工具列表
  - read
  - write
  - bash
metadata:                     # 可选：其他元数据
  version: "1.0.0"
  author: "Your Name"
  tags: ["automation", "utils"]
---
```

### 验证规则

| 字段 | 规则 |
|------|------|
| `name` | 必需；kebab-case 格式；长度 ≤64 字符 |
| `description` | 必需；长度 ≤1024 字符；不能包含 `<` 或 `>` |
| `license` | 可选；字符串 |

### Skill 命名约定

✅ **Good:**
- `code-generator`
- `pdf-processor`
- `api-tester`
- `skill-creator-v2`

❌ **Bad:**
- `Code_Generator` (应使用 kebab-case)
- `pdf processor` (不能有空格)
- `api-tester-with-advanced-features-and-more` (太长)

---

## 示例

### 示例 1: 简单 Skill

**目录结构:**
```
skills/
└── hello-world/
    └── SKILL.md
```

**SKILL.md:**
```markdown
---
name: hello-world
description: 一个简单的 hello world skill，用于演示最基本的 skill 结构。
---

# Hello World Skill

这是最简单的 skill 示例。

当用户说 "hello" 时，使用此 skill 回复友好的问候。
```

### 示例 2: 带脚本的 Skill

**目录结构:**
```
skills/
└── code-formatter/
    ├── SKILL.md
    └── scripts/
        ├── format_python.py
        └── format_js.sh
```

**SKILL.md:**
```markdown
---
name: code-formatter
description: 格式化代码文件。支持 Python 和 JavaScript。
license: MIT
---

# Code Formatter Skill

使用标准工具格式化代码文件。

## 支持的语言

- Python (使用 black)
- JavaScript (使用 prettier)

## 使用方法

1. 识别文件类型
2. 运行对应的格式化脚本：
   - Python: `python scripts/format_python.py <file>`
   - JavaScript: `bash scripts/format_js.sh <file>`
3. 报告结果
```

### 示例 3: 完整 Skill

**目录结构:**
```
skills/
└── api-generator/
    ├── SKILL.md
    ├── scripts/
    │   ├── init_project.py
    │   └── generate_api.py
    ├── references/
    │   ├── api_patterns.md
    │   └── best_practices.md
    └── assets/
        ├── openapi_template.yaml
        └── README_template.md
```

---

## 测试

### 运行 Skills 系统测试

```bash
# 编译项目
npm run build

# 运行测试脚本
node test-skills.js
```

### 预期输出

```
============================================================
Testing Skills System
============================================================

Loading skills from: /path/to/skills

✓ Successfully loaded 1 skill(s)

Loaded Skills:
------------------------------------------------------------
1. example-skill
   Description: 这是一个示例 skill，展示如何创建和组织 skill 的结构...
   Path: /path/to/skills/example-skill
   License: MIT

============================================================
✓ Skills system test completed successfully!
============================================================
```

### 验证 Skill

确保你的 skill 满足以下条件：
- [ ] 存在 `SKILL.md` 文件
- [ ] YAML frontmatter 格式正确（以 `---` 开头和结尾）
- [ ] 包含必需字段 `name` 和 `description`
- [ ] `name` 使用 kebab-case 格式
- [ ] `description` 长度不超过 1024 字符
- [ ] 测试脚本能成功加载该 skill

---

## 最佳实践

### 1. 清晰的 Description
description 应该明确说明：
- Skill 的功能
- 何时使用此 skill
- 适用的场景

```yaml
# ✅ Good
description: 生成 REST API 代码和文档。当用户需要创建新的 API 端点或生成 OpenAPI 规范时使用。

# ❌ Bad
description: 一个很有用的工具。
```

### 2. 结构化的文档
SKILL.md 应该包含：
- 简介
- 何时使用
- 工作流程
- 示例
- 注意事项

### 3. 模块化设计
- 每个 skill 专注一个领域
- 复杂任务拆分为多个 skills
- 可重用的组件

### 4. 自包含
- Skill 应包含完成任务所需的所有资源
- 避免依赖外部文件或配置
- 在 SKILL.md 中说明任何前置条件

### 5. 版本控制
在 metadata 中记录版本信息：

```yaml
metadata:
  version: "1.0.0"
  changelog: "references/CHANGELOG.md"
  compatibility: "sbot >= 1.0.0"
```

---

## 技术参考

### API

```typescript
// 加载所有 skills
import { loadSkills } from './Skills';
const skills = loadSkills('/path/to/skills');

// 解析单个 skill
import { parseSkill } from './Skills';
const skill = parseSkill('/path/to/skill-directory');

// 验证 skill 目录
import { isValidSkillDirectory } from './Skills';
const isValid = isValidSkillDirectory('/path/to/skill-directory');

// 读取 SKILL.md 内容
import { readSkillContent } from './Skills';
const content = readSkillContent(skill);
```

### 类型定义

```typescript
interface Skill {
    name: string;           // Skill 名称
    description: string;    // Skill 描述
    license?: string;       // 许可证
    path: string;          // 目录路径
}

interface SkillMetadata {
    name: string;
    description: string;
    license?: string;
    'allowed-tools'?: string[];
    metadata?: Record<string, any>;
}
```

---

## 故障排除

### Skill 未加载

1. 检查目录结构：确保 `SKILL.md` 存在
2. 验证 YAML frontmatter：必须以 `---` 开头
3. 检查字段：确保包含 `name` 和 `description`
4. 查看日志：运行 `node test-skills.js` 查看详细错误

### YAML 解析错误

常见问题：
- YAML 缩进错误（使用空格，不使用 Tab）
- 字符串包含特殊字符（使用引号）
- frontmatter 未正确闭合（需要两个 `---`）

```yaml
# ✅ Correct
---
name: my-skill
description: "This is a description with special chars: <tag>"
---

# ❌ Wrong - 缺少结束的 ---
---
name: my-skill
description: My description
```

---

## 扩展阅读

- [Mini-OpenCode Skills 文档](https://github.com/anthropics/mini-opencode)
- [YAML 规范](https://yaml.org/spec/1.2/spec.html)
- [Markdown 指南](https://www.markdownguide.org/)

---

## 贡献

欢迎创建新的 skills 并分享！如果你创建了有用的 skill，可以：
1. 提交到项目仓库
2. 分享给团队成员
3. 发布为独立的 .skill 包

---

**Happy Skill Building! 🚀**
