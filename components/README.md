# `components` 前端组件说明

该目录存放跨页面复用的 React 组件。当前 `ui/` 主要是基于 shadcn 结构和可访问组件原语的基础控件。

## 什么时候使用这里

- 两个或更多页面需要同一种组件。
- 组件表达通用交互，例如 Button、Dialog、Table、Select。
- 需要统一处理焦点、键盘操作、Disabled、Loading 或错误状态。

只属于某个页面、且不会复用的业务组件，应放在对应路由附近，而不是立即放入 `components/ui/`。

## 修改规则

- `ui/` 中的改动会影响多个页面，提交前应搜索全部使用位置。
- 优先通过 Variant 或组合扩展，不复制一个只有颜色不同的新组件。
- 颜色、字号、间距、圆角和动效必须使用 `uidesign.md` 与 `app/globals.css` 中的 Token。
- 图标统一使用 Lucide；图标与可见文字重复时设置 `aria-hidden="true"`。
- 图标按钮必须提供可访问名称，表单控件必须有标签和错误关联。
- 保留第三方组件要求的键盘、焦点和 ARIA 行为。

## 相关配置

- `components.json`：shadcn 组件生成与路径别名配置。
- `lib/utils.ts`：`cn()` className 合并工具。
- `app/globals.css`：组件使用的语义色和全局状态。
- `vendor/`：随仓库保存的第三方基础样式与许可证。

更完整的仓库说明见 [`docs/repository-guide.md`](../docs/repository-guide.md)。
