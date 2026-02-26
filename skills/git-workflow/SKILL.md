---
name: git-workflow
description: "辅助 Git 工作流操作，包括提交规范、分支管理、冲突解决和 PR 模板生成"
---

# Git Workflow Skill

## 适用场景

当用户涉及 Git 操作、提交消息、分支策略、代码合并、版本管理相关请求时使用此 skill。

## 功能模块

### 1. 提交规范（Conventional Commits）

提交格式：`<type>(<scope>): <subject>`

类型说明：
- `feat`: 新功能
- `fix`: Bug 修复
- `docs`: 文档更新
- `style`: 代码格式（不影响逻辑）
- `refactor`: 重构
- `test`: 测试相关
- `chore`: 构建/工具链变更
- `perf`: 性能优化

示例：
```
feat(auth): add OAuth2 login support

- Add Google OAuth2 provider
- Add token refresh mechanism
- Update user profile on first login

Closes #123
```

### 2. 分支命名规范

```
feature/<描述>     # 新功能
fix/<issue-id>-<描述>   # Bug 修复
hotfix/<描述>      # 紧急修复
release/<version>  # 发布分支
chore/<描述>       # 杂项任务
```

### 3. PR / MR 模板

```markdown
## 变更描述
[简要描述本次变更的目的和内容]

## 变更类型
- [ ] 新功能
- [ ] Bug 修复
- [ ] 重构
- [ ] 文档更新
- [ ] 其他

## 测试
- [ ] 已添加单元测试
- [ ] 已通过本地测试
- [ ] 已更新文档

## 关联 Issue
Closes #<issue-number>
```

### 4. 冲突解决流程

1. `git fetch origin`
2. `git rebase origin/main`（或 merge，视项目规范）
3. 逐个解决冲突文件
4. `git add <resolved-files>`
5. `git rebase --continue`

## 使用说明

根据用户的具体需求，选择对应功能模块提供指导。
如需执行 Git 命令，配合 `execute_command` 工具使用。
