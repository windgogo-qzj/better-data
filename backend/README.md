# `backend` 本地后端说明

该目录是 Better Data 的 Python/FastAPI 服务。它负责接收表格、创建本地项目、计算文件摘要和生成初步数据画像。

## 结构

```text
backend/
├─ src/better_data/
│  ├─ main.py
│  ├─ config.py
│  ├─ models.py
│  └─ services/
│     ├─ project_store.py
│     ├─ analysis.py
│     ├─ pipeline.py
│     ├─ evaluation.py
│     └─ profiling.py
├─ tests/
│  ├─ fixtures/
│  └─ test_health.py
├─ pyproject.toml
└─ requirements-lock.txt
```

| 路径 | 职责 |
| --- | --- |
| `main.py` | 创建 FastAPI 应用、配置本地 CORS、定义健康检查和项目 API |
| `config.py` | 项目库路径、CSV/XLSX 大小限制、画像抽样行数 |
| `models.py` | Pydantic 请求/响应结构、任务类型和项目状态 |
| `services/project_store.py` | 安全保存上传文件、项目目录、SHA-256 和 `project.json` |
| `services/profiling.py` | 使用 Polars/OpenPyXL 抽样读取 CSV/XLSX 并生成字段画像 |
| `services/analysis.py` | 推断字段角色、计算六维质量评分、生成可追溯建议并标记冲突 |
| `services/pipeline.py` | 先划分后拟合的分类/回归基础预处理、Parquet 工作文件和 JSON 学习状态 |
| `services/evaluation.py` | 同划分快速基线比较、UTF-8 BOM CSV、离线 HTML 报告和文件哈希 |
| `tests/` | 后端自动化测试；测试数据必须为合成数据或允许再分发的数据 |

## API

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `GET` | `/api/health` | 返回版本、离线状态和服务健康状态 |
| `GET` | `/api/projects` | 返回本机项目列表 |
| `GET` | `/api/projects/{project_id}` | 返回单个项目详情 |
| `POST` | `/api/projects` | 接收任务类型和数据文件，创建项目并执行初始画像 |
| `DELETE` | `/api/projects/{project_id}` | 将非运行中的项目安全移入回收站 |
| `GET` | `/api/trash` | 返回回收站中的项目列表 |
| `POST` | `/api/trash/{project_id}/restore` | 将项目恢复到项目库 |
| `DELETE` | `/api/trash/{project_id}` | 永久删除回收站项目及其本地文件 |
| `GET` | `/api/projects/{project_id}/analysis` | 返回字段角色、质量评分、证据和处理建议 |
| `PUT` | `/api/projects/{project_id}/fields` | 保存完整字段角色并重新计算分析 |
| `PUT` | `/api/projects/{project_id}/recommendations` | 保存建议启停状态并阻止冲突组合 |
| `POST` | `/api/projects/{project_id}/pipeline-runs` | 执行一次固定种子的安全预处理 |
| `GET` | `/api/projects/{project_id}/pipeline-runs/latest` | 返回最近一次流水线配置、学习状态和内部文件摘要 |
| `POST` | `/api/projects/{project_id}/evaluation` | 生成快速评估、CSV 和离线 HTML 报告 |
| `GET` | `/api/projects/{project_id}/evaluation` | 返回最近一次评估与导出清单 |
| `GET` | `/api/projects/{project_id}/artifacts/{artifact_name}` | 从固定白名单下载结果 CSV 或离线报告 |
| `GET` | `/api/settings/project-library` | 返回项目库路径、可写状态、项目数和首次设置状态 |
| `PUT` | `/api/settings/project-library` | 验证并保存新的项目库绝对路径 |
| `GET` | `/api/docs` | FastAPI 自动生成的本地接口文档 |

## 本地存储

默认项目库为仓库根目录下的 `work/projects/`，也可以通过 `BETTER_DATA_LIBRARY` 环境变量指定。每个项目使用独立 ID 目录：

```text
work/projects/<project-id>/
├─ project.json
├─ analysis.json  # 版本化字段、评分与规则建议
├─ pipeline-config.json # 最近一次确认的流水线配置
├─ source/       # 原始上传文件
├─ working/      # 中间工作数据
├─ results/      # 处理结果
├─ reports/      # 报告
├─ exports/      # 导出包
└─ logs/         # 操作与错误记录
```

项目被移除时会完整移动到项目库同级的 `.trash/<project-id>/`，`project.json` 中记录移除时间。恢复时保留原项目 ID；如果项目库已存在同名 ID，服务端会拒绝覆盖。永久删除只接受严格的 32 位十六进制项目 ID，并再次校验目标目录位于 `.trash` 内。

流水线成功后，`working/` 包含处理后的 `train.parquet`、`test.parquet`，同一划分的 `train-raw.parquet`、`test-raw.parquet`，以及 `target-missing.parquet` 和 `pipeline-state.json`。字段角色或建议选择改变时，这些派生文件会失效并删除；`source/` 中的原始文件不受影响。

纯数据清洗不划分训练集和测试集，结果写入 `working/processed.parquet`，再由结果接口生成 `exports/processed.csv` 与离线报告。聚类预处理执行属于 Beta，MVP 只允许完成画像、字段确认和建议审阅。

`work/` 包含用户数据，已被 Git 忽略。不要把其中内容复制进测试、Issue 或 Pull Request。

项目库根目录包含 `.better-data-library.json` 标记。系统只会接管空文件夹、已有标记的项目库或能识别的旧项目库；普通非空文件夹会被拒绝。全局选择默认写入 `work/app-settings.json`，更新采用临时文件原子替换。

## CSV 导入边界

- MVP 接受 UTF-8 与 UTF-8 BOM 编码。
- 支持逗号、分号、TAB 和竖线分隔符自动识别。
- 空文件、空表头、重复表头、损坏行和不支持的编码会返回明确错误。
- 画像读取行数由 `profile_sample_rows` 控制，返回 `is_sampled`、字段统计和最多五行预览。
- 画像失败的项目保留原始文件和错误记录；未完成上传的临时项目会被清理。

## 开发原则

- 大文件必须流式读取或有明确抽样策略，避免一次载入全部内容。
- 所有用户输入路径都必须限制在项目库内，不能允许路径逃逸。
- 原始文件保持只读语义，处理结果写入其他目录。
- API 结构变化需要同步更新 `models.py`、前端类型和测试。
- 异常应保存可理解的错误信息，但日志不得包含真实字段样例或敏感数据。

## 运行与测试

```powershell
# 仓库根目录
.\.venv\Scripts\python.exe -m pip install -e ".\backend[dev]"
.\.venv\Scripts\python.exe -m uvicorn better_data.main:app --host 127.0.0.1 --port 8000

# 测试
Set-Location backend
..\.venv\Scripts\python.exe -m pytest
```

更完整的仓库说明见 [`docs/repository-guide.md`](../docs/repository-guide.md)。
