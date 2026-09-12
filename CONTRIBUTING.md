# 参与开发

Better Data 使用 GitHub Issues、Milestones、短生命周期分支、Pull Requests、Actions 和 Releases 管理开发。说明文字以中文为主，代码标识符保持英文。

## 开始前

1. 阅读 [README](README.md)、[仓库导览](docs/repository-guide.md)和[系统架构](docs/architecture.md)。
2. 搜索现有 Issue，避免重复工作。
3. 为可独立验收的目标建立 Issue，并写明复现步骤、验收条件、风险和范围外事项。
4. 将 Issue 关联到对应 Milestone；没有发布计划的维护事项也应有明确优先级。

## 分支与提交

- 从最新 `main` 创建短生命周期分支。
- Codex 创建的分支使用 `codex/<主题>`；人工功能分支可使用 `feat/<issue>-<主题>`、`fix/<issue>-<主题>` 或 `docs/<主题>`。
- 一个分支聚焦一个 Issue 或一个紧密相关的发布目标。
- 提交信息使用 `<type>: <结果>`，推荐类型为 `feat`、`fix`、`docs`、`test`、`refactor`、`chore`。
- 提交应能独立解释行为变化；不要使用“update”“调整一下”等无法审计的说明。
- 不重写已经共享的历史，不在功能分支混入无关格式化或生成文件。

## Pull Request

Pull Request 必须：

- 使用 `Closes #<编号>` 关联 Issue。
- 说明问题、实现、验证证据、风险、已知限制和回滚方式。
- 同步更新 README、CHANGELOG、开发日志、API 或架构文档中的相关内容。
- UI 变化附桌面和窄屏证据；完整流程变化附端到端验证结果。
- 后端行为变化附自动化测试，不以手工点击代替可重复测试。
- 等待 GitHub Actions 全部通过，并完成审阅后再合并。

## 本地质量门禁

在提交 Pull Request 前，从仓库根目录执行：

```powershell
pnpm lint
pnpm build
Set-Location backend
..\.venv\Scripts\python.exe -m pytest -q
Set-Location ..
git diff --check
```

如果某项无法执行，必须在 Pull Request 中说明原因、影响和替代验证；不得把“未运行”写成“通过”。

## 数据与安全

- 不得提交真实用户数据、项目库、Parquet 工作副本、导出结果、访问令牌、密钥或含真实字段样例的日志。
- 测试和文档截图只使用人工合成或明确允许再分发的数据。
- 所有用户输入路径必须限制在项目库边界内；删除和覆盖操作需要服务端再次校验。
- 原始文件保持只读语义，派生数据写入独立目录。
- 新依赖必须说明必要性、许可证和对离线运行的影响。

## 发布

普通功能 Pull Request 不直接创建标签。发布负责人按照[发布流程](docs/release-process.md)完成版本冻结、Release Issue、CI、合并、带说明标签和 GitHub Release，并在发布后验证版本与下载入口。
