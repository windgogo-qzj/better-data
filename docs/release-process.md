# Better Data 发布流程

本文定义可重复、可审计的版本发布流程。版本标签使用 `vX.Y.Z`，代码包版本使用 `X.Y.Z`。

## 1. 建立发布范围

1. 创建或确认版本 Milestone。
2. 创建 Release Issue，列出范围、风险、质量门禁和发布后检查。
3. 确认目标功能 Issue 均已关闭或明确移出本版本。
4. 从最新 `main` 创建 `codex/release-vX.Y.Z` 或 `release/vX.Y.Z` 分支。

## 2. 发布前审计

- 比较上一个标签到 `HEAD` 的提交、PR、Issue 和用户可见行为。
- 确认所有代码变化可追溯到 Issue、PR、开发日志或 CHANGELOG。
- 检查工作区中没有真实数据、密钥、本机路径、临时文件和未解释的生成物。
- 检查兼容性边界、已知限制和迁移需求。
- 如果包含 UI 变化，使用合成数据重新生成并目视检查截图。

## 3. 准备发布分支

必须在同一个 Pull Request 中同步：

- `package.json`、`backend/pyproject.toml` 和 Python 包版本。
- 健康检查版本测试。
- `CHANGELOG.md` 的发布日期和用户可见变化。
- README、路线图、开发日志、API 或架构文档。
- `docs/releases/vX.Y.Z.md` 发布说明。

## 4. 本地质量门禁

```powershell
pnpm lint
pnpm build
Set-Location backend
..\.venv\Scripts\python.exe -m pytest -q
Set-Location ..
git diff --check
```

同时执行与版本风险对应的手工检查：

- 首页、项目库和关键深链接可打开。
- 使用合成数据完成创建、字段确认、诊断、方案、执行和结果导出。
- 项目可以移入回收站、恢复并永久删除。
- README 图片不是空白页，不包含真实项目或用户数据。

任何门禁失败都停止发布。修复后从失败项开始重新验证，并执行完整回归。

## 5. Pull Request 与 CI

1. 推送发布分支并创建 Pull Request，使用 `Closes #<Release Issue>`。
2. 填写变更、验证、风险、截图和回滚方式。
3. 等待所有 GitHub Actions 成功；不得绕过失败或进行中的检查。
4. 审阅最终差异，确认版本号一致且没有超出发布范围的内容。
5. 合并到 `main`，然后拉取并确认本地 `main` 与远端一致。

## 6. 标签与 GitHub Release

从合并后的 `main` 创建带说明标签：

```powershell
git tag -a vX.Y.Z -m "Better Data vX.Y.Z"
git push origin vX.Y.Z
gh release create vX.Y.Z --verify-tag --title "Better Data vX.Y.Z" --notes-file docs/releases/vX.Y.Z.md
```

标签必须指向发布 Pull Request 的合并提交。不要在功能分支或未通过 CI 的提交上打标签。

## 7. 发布后核验

- GitHub Release 标题、标签、说明和源代码归档可以访问。
- `/api/health` 返回代码包版本 `X.Y.Z`。
- Release Issue 已关闭，Milestone 内没有遗漏事项后再关闭 Milestone。
- `main` 工作区干净，标签和远端分支状态一致。
- README 中的版本链接与截图可正常显示。

## 8. 回滚与热修复

- 已发布标签不可移动或静默覆盖。
- 文档错误通过新的 Pull Request 修复。
- 功能缺陷建立独立 Issue，从发布标签或最新 `main` 创建 `fix/` 分支，并发布新的补丁版本。
- 只有在标签泄露密钥或包含高风险数据时才删除 Release 或标签，同时保留安全事件记录并立即轮换凭据。
