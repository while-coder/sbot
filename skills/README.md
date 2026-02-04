# Skills 系统

这个目录包含所有可用的 skills。Skills 是为特定任务优化工作流的自包含模块。

## Skills 目录位置

**重要**: Skills 目录位于配置目录下，而不是项目根目录：
- **配置目录**: `~/.sbot/skills/` (Linux/Mac) 或 `C:\Users\{用户名}\.sbot\skills\` (Windows)
- 这样做的好处是多个项目可以共享同一套 skills

## 什么是 Skill？

Skill 是一个包含以下内容的目录：
- `SKILL.md` - 必需的主文件，包含元数据和使用指南
- `scripts/` - 可选的可执行脚本
- `references/` - 可选的参考文档
- `assets/` - 可选的资源文件

## 如何创建 Skill

1. 在配置目录的 `skills/` 文件夹下创建新文件夹（使用 kebab-case 命名）
   ```bash
   # Linux/Mac
   mkdir -p ~/.sbot/skills/my-skill

   # Windows
   mkdir %USERPROFILE%\.sbot\skills\my-skill
   ```
2. 创建 `SKILL.md` 文件
3. 添加 YAML frontmatter：
   ```yaml
   ---
   name: my-skill
   description: 这个 skill 的作用和使用场景
   license: MIT
   ---
   ```
4. 在 YAML frontmatter 后添加详细的使用指南
5. 根据需要添加 scripts、references 或 assets 目录

## Skill 命名规范

- 使用 kebab-case（小写字母、数字、连字符）
- 名称应该描述 skill 的功能
- 长度不超过 64 字符

## 示例

参考 `example-skill/` 目录查看完整的 skill 结构示例。

## Skills 加载

Skills 会在 AgentService 初始化时自动加载。加载的 skills 信息会被注入到 AI 的系统提示词中，使 AI 能够：
1. 了解可用的 skills
2. 在合适的时候选择使用相应的 skill
3. 读取 skill 目录下的文件获取详细信息
4. 执行 skill 中的脚本

## 可用的 Skills

当前目录下的所有有效 skill：
- [example-skill](./example-skill/SKILL.md) - 示例 skill，展示结构和最佳实践

## 技术细节

- Skills 通过 `src/Skills/loader.ts` 加载
- 元数据通过 `src/Skills/parser.ts` 解析
- 集成到 `src/Agent/AgentService.ts` 的系统提示词中

## 最佳实践

1. **清晰的描述**: 在 description 字段明确说明何时使用此 skill
2. **完整的文档**: SKILL.md 应包含详细的使用指南
3. **模块化设计**: 将复杂任务分解为多个 skills
4. **自包含**: skill 应包含完成任务所需的所有资源
5. **版本控制**: 在 metadata 中记录版本信息

## 扩展阅读

- [Mini-OpenCode Skills 系统文档](https://github.com/anthropics/mini-opencode)
- TypeScript 实现参考：`src/Skills/`
