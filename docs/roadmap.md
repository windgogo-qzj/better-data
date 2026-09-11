# Better Data 开发路线图

## MVP — v0.1.0 已完成（2026-09-11）

- [x] 项目库与项目生命周期
- [x] CSV 上传、流式副本、基础结构识别和预览
- [x] 纯清洗、分类及回归任务配置
- [x] 字段角色确认
- [x] 基础缺失、重复、类型、类别和缩放处理
- [x] 80/20 划分及训练集拟合边界
- [x] 快速评估、HTML 报告和 CSV 导出

完成证据：PR [#11](https://github.com/windgogo-qzj/better-data/pull/11)、[#12](https://github.com/windgogo-qzj/better-data/pull/12)、[#13](https://github.com/windgogo-qzj/better-data/pull/13)、[#14](https://github.com/windgogo-qzj/better-data/pull/14)、[#15](https://github.com/windgogo-qzj/better-data/pull/15) 和 [#17](https://github.com/windgogo-qzj/better-data/pull/17) 均经 GitHub Actions 验证后合并。最终自动化基线为 29 项后端测试、前端 ESLint 和生产构建全部通过。

MVP 的“已完成”只表示以上清单形成可运行闭环，不代表 v1.0 完成。XLSX 全量执行、聚类诊断、后台任务、完整 ZIP、Python 复现脚本、1 GB 性能优化和 Windows 安装包仍按下列阶段推进。

## Beta

- XLSX 输入与 Parquet 工作副本
- 聚类前预处理和诊断性评估
- KNN、迭代式填充、SMOTE、PCA 和高级特征工程
- 规则冲突、敏感字段、业务校验和详细血缘
- 后台任务、步骤缓存、取消和恢复
- 完整 ZIP 与可复现 Python 脚本

## v1.0

- 1 GB CSV 能力分级与性能优化
- 资源预检、维度膨胀保护和缓存生命周期
- 安全加固、Windows 启动器、系统托盘和通知
- 安装包、离线验收、性能基准和代码签名准备
- GitHub Actions、阶段 Release 和完整发布文档

## 里程碑验收原则

每个里程碑必须具有可运行界面、对应自动测试、已知限制、验证记录和中文发布说明。不得以未接通后端的静态页面冒充功能完成。
