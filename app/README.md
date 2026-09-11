# `app` 前端模块说明

该目录使用 Next.js App Router 结构，由 Vinext/Vite 构建。它只负责界面、交互和调用本机 API，不直接处理大型表格。

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `page.tsx` | 连续式产品首页与进入工作台的唯一主入口 |
| `landing-workflow-story.tsx` | 首页五阶段交互流程与同步产品界面 |
| `workspace/page.tsx` | 项目台账、搜索、回收站、项目库设置与服务状态 |
| `projects/new/page.tsx` | 独立的数据文件选择、任务配置、导入状态和错误反馈流程 |
| `projects/project-journey.tsx` | 创建到导出的统一七阶段导航 |
| `projects/[projectId]/page.tsx` | 旧项目地址的兼容入口，转到项目数据概览 |
| `projects/[projectId]/[step]/page.tsx` | 概览、字段、质量、方案、执行和结果分阶段页面 |
| `layout.tsx` | 全局 HTML 结构、中文语言属性、Metadata 和 favicon |
| `globals.css` | 设计 Token、全局样式、响应式布局和可访问状态 |
| `chatgpt-auth.ts` | 脚手架预留的认证辅助函数；当前产品不登录，主流程没有调用 |

## 前端边界

- 数据文件通过 `FormData` 发送到 `http://127.0.0.1:8000/api/projects`。
- 前端可以展示抽样画像和任务状态，但不得在浏览器中加载或复制整份大型数据。
- 页面使用 `components/ui/` 中的通用组件，并遵循根目录 `uidesign.md`。
- 所有用户可见文案使用中文，API 字段和代码标识符保持英文。
- 浏览器中的项目库设置只保存路径，不移动或删除旧目录；系统文件夹选择器由后续 Windows 启动器提供。
- 项目移除先进入回收站并提供撤销或恢复；永久删除必须经过二次确认。
- 首页使用真实数据结构和连续流程表达产品，不使用孤立功能卡片或无依据的装饰性动画。
- 字段和建议更改通过本地 API 保存；前端不直接判断建议冲突，也不会执行数据变换。
- 预处理执行前必须先保存字段与建议；界面展示训练集拟合边界和内部工作文件摘要，正式导出由结果阶段负责。
- 结果区只使用后端返回的固定下载 URL；浏览器不拼接或提交本机文件路径。
- 纯清洗使用完整数据流程和单一结果文件；聚类执行入口在 MVP 中明确禁用并说明 Beta 边界。

## 修改页面时

1. 先确认需求是否需要更新 `docs/requirements.md`。
2. 涉及视觉规则时先更新 `uidesign.md`。
3. 优先组合已有 UI 原语，不在页面中重复创建基础组件。
4. 为异步操作提供 Loading、Disabled、成功和错误反馈。
5. 保持键盘可操作、可见焦点、语义化标签和减少动效支持。
6. 在 375、768、1024、1440px 下检查布局。

## 验证

在仓库根目录运行：

```powershell
pnpm lint
pnpm build
```

更完整的目录说明见 [`docs/repository-guide.md`](../docs/repository-guide.md)。
