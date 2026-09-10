# Better Data

Better Data 是一个面向数据分析人员的 Windows 本地数据预处理工作台。它通过浏览器界面组织字段确认、质量检查、预处理建议、特征工程、快速评估和结果导出，实际数据始终由本机后端处理。

> 当前状态：MVP 开发中。首页工作台已经建立，后端项目与数据画像能力正在实现。

## 产品原则

- 数据默认不离开本机，断网后仍可使用。
- 自动建议必须说明证据、风险、置信度和预计影响。
- 训练集拟合、测试集转换，防止预处理数据泄漏。
- 原始文件只读保存，所有操作可追踪、可撤销、可复现。
- 大数据处理按算法能力选择全量、抽样、降级或禁用。

## v1.0 范围

- 分类、回归、聚类前预处理和纯数据清洗
- CSV（最高 1 GB）与 XLSX（最高 200 MB）
- 缺失值、重复值、异常值、类型转换和类别处理
- 特征工程、特征选择、类别不平衡处理和可选降维
- 关闭或快速两档效果评估
- CSV、可选 XLSX 或完整 ZIP 结果包导出
- 单文件离线 HTML 报告和可复现 Python 脚本

详细需求见 [产品需求规格](docs/requirements.md)，技术设计见 [系统架构](docs/architecture.md)。

## 技术方向

- 前端：React、TypeScript、Tailwind CSS 与可访问组件库
- 本地后端：Python、FastAPI
- 数据处理：Polars、DuckDB、PyArrow
- 建模评估：scikit-learn、imbalanced-learn
- 项目状态：SQLite；内部工作数据：Parquet

## 本地开发

需要 Node.js 22、pnpm 11 和 Python 3.12。

```powershell
pnpm install
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".\backend[dev]"
```

分别启动本地 API 和前端：

```powershell
.\.venv\Scripts\python.exe -m uvicorn better_data.main:app --host 127.0.0.1 --port 8000
pnpm dev
```

浏览器访问 `http://127.0.0.1:5173`。运行后端测试使用：

```powershell
Set-Location backend
..\.venv\Scripts\python.exe -m pytest
```

## 开发记录

本项目使用 GitHub Issues、Milestones、Pull Requests、Actions 和 Releases 记录从需求到发布的全过程。开发文档及提交说明以中文为主，代码标识符保持英文。

## 许可证

当前暂不添加开源许可证。在明确许可证前，仓库内容不视为开放授权。
