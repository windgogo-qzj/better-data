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
| `tests/` | 后端自动化测试；测试数据必须为合成数据或允许再分发的数据 |

## API

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `GET` | `/api/health` | 返回版本、离线状态和服务健康状态 |
| `GET` | `/api/projects` | 返回本机项目列表 |
| `POST` | `/api/projects` | 接收任务类型和数据文件，创建项目并执行初始画像 |
| `GET` | `/api/docs` | FastAPI 自动生成的本地接口文档 |

## 本地存储

默认项目库为仓库根目录下的 `work/projects/`，也可以通过 `BETTER_DATA_LIBRARY` 环境变量指定。每个项目使用独立 ID 目录：

```text
work/projects/<project-id>/
├─ project.json
├─ source/       # 原始上传文件
├─ working/      # 中间工作数据
├─ results/      # 处理结果
├─ reports/      # 报告
├─ exports/      # 导出包
└─ logs/         # 操作与错误记录
```

`work/` 包含用户数据，已被 Git 忽略。不要把其中内容复制进测试、Issue 或 Pull Request。

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
