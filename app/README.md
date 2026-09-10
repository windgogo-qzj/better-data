# `app` 前端模块说明

该目录使用 Next.js App Router 结构，由 Vinext/Vite 构建。它只负责界面、交互和调用本机 API，不直接处理大型表格。

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `page.tsx` | 首页工作台、项目列表、项目库设置、文件选择、任务类型和创建项目交互 |
| `projects/[projectId]/page.tsx` | 项目字段确认、六维质量评分、扣分证据和建议启停工作台 |
| `layout.tsx` | 全局 HTML 结构、中文语言属性、Metadata 和 favicon |
| `globals.css` | 设计 Token、全局样式、响应式布局和可访问状态 |
| `chatgpt-auth.ts` | 脚手架预留的认证辅助函数；当前产品不登录，主流程没有调用 |

## 前端边界

- 数据文件通过 `FormData` 发送到 `http://127.0.0.1:8000/api/projects`。
- 前端可以展示抽样画像和任务状态，但不得在浏览器中加载或复制整份大型数据。
- 页面使用 `components/ui/` 中的通用组件，并遵循根目录 `uidesign.md`。
- 所有用户可见文案使用中文，API 字段和代码标识符保持英文。
- 浏览器中的项目库设置只保存路径，不移动或删除旧目录；系统文件夹选择器由后续 Windows 启动器提供。
- 字段和建议更改通过本地 API 保存；前端不直接判断建议冲突，也不会执行数据变换。

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
