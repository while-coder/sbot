---
name: example-skill
description: 这是一个示例 skill，展示如何创建和组织 skill 的结构。当用户询问如何创建 skill 或需要 skill 模板时使用。
license: MIT
---

# Example Skill

这是一个示例 skill，展示了 skill 的标准结构和最佳实践。

## Skill 结构

一个完整的 skill 应该包含以下组件：

### 1. SKILL.md（必需）
- 包含 YAML frontmatter（元数据）
- 提供详细的使用指南和工作流
- 说明何时以及如何使用此 skill

### 2. scripts/ 目录（可选）
包含可执行的脚本文件：
- Python 脚本（.py）
- Shell 脚本（.sh）
- Node.js 脚本（.js/.ts）

### 3. references/ 目录（可选）
包含参考文档：
- API 文档
- 技术规范
- 示例代码
- 工作流模式

### 4. assets/ 目录（可选）
包含资源文件：
- 模板文件
- 配置文件示例
- 图片资源

## YAML Frontmatter 规范

```yaml
---
name: skill-name              # 必需：kebab-case 格式，长度 ≤64 字符
description: ...              # 必需：描述和使用场景，长度 ≤1024 字符，不能包含 < 或 >
license: MIT                  # 可选：许可证信息
allowed-tools:                # 可选：此 skill 允许使用的工具列表
  - read
  - write
  - bash
metadata:                     # 可选：其他元数据
  version: "1.0.0"
  author: "Your Name"
---
```

## 如何使用 Skills

### 对于 AI Agent：
1. **识别**: 根据用户请求判断是否需要使用某个 skill
2. **告知**: 告诉用户将使用该 skill 处理任务
3. **理解**: 从 skill 描述中理解工作流程
4. **访问**: 如需详细信息，读取 skill 目录下的相关文件
5. **执行**: 按照 skill 的指导完成任务

### 对于开发者：
1. 在 `skills/` 目录下创建新的子目录
2. 创建 `SKILL.md` 文件并填写 frontmatter 和内容
3. 添加必要的 scripts、references 或 assets
4. 重启应用，skill 会自动加载

## 示例场景

假设用户说："帮我创建一个 PDF 处理工具"

AI Agent 应该：
1. 识别到这可能需要创建新功能
2. 如果有 code-generator skill，告知用户将使用它
3. 读取该 skill 的详细指南
4. 按照指南中的步骤执行：
   - 分析需求
   - 设计 API
   - 生成代码
   - 创建测试
   - 生成文档

## 最佳实践

1. **保持专注**: 每个 skill 应专注于一个特定领域或任务
2. **清晰文档**: 提供清晰的使用说明和示例
3. **模块化**: 将复杂任务分解为可重用的组件
4. **可发现**: 在 description 中明确说明何时使用此 skill
5. **自包含**: skill 应该包含完成任务所需的所有资源

## 进阶功能

### 多文件组织
对于复杂的 skill，可以在 SKILL.md 中引用其他文件：

```markdown
详细的 API 文档请参考：[API Reference](references/api.md)

要运行初始化脚本，执行：
\`\`\`bash
python scripts/init.py
\`\`\`
```

### 版本控制
在 metadata 中添加版本信息：

```yaml
metadata:
  version: "1.0.0"
  changelog: "references/CHANGELOG.md"
```

## 总结

Skills 系统允许你扩展 AI Agent 的能力，为特定任务提供专业的工作流和指导。通过创建结构良好的 skills，可以显著提升 AI 在特定领域的表现。
