from __future__ import annotations

import re

from better_data.models import (
    ColumnProfile,
    ColumnRole,
    FieldRole,
    ProjectAnalysis,
    ProjectRecord,
    QualityDeduction,
    QualityDimension,
    QualityReport,
    RiskLevel,
    RuleRecommendation,
    TaskType,
)

SUPERVISED_TASKS = {TaskType.CLASSIFICATION, TaskType.REGRESSION}
NUMERIC_TYPES = ("Int", "UInt", "Float", "Decimal")
ID_NAME_PATTERN = re.compile(r"(^id$|_id$|id_|编号|代码|编码|code|key)", re.IGNORECASE)


def build_project_analysis(
    project: ProjectRecord,
    *,
    saved_roles: dict[str, ColumnRole] | None = None,
    enabled_ids: set[str] | None = None,
    fields_confirmed: bool = False,
) -> ProjectAnalysis:
    if project.profile is None:
        raise ValueError("项目尚未生成可用的数据画像")

    profile = project.profile
    roles = {
        column.name: (saved_roles or {}).get(column.name, infer_role(column, profile.sampled_rows))
        for column in profile.columns
    }
    fields = [
        FieldRole(name=column.name, role=roles[column.name], inferred_type=column.inferred_type)
        for column in profile.columns
    ]
    quality = _build_quality(project, roles)
    recommendations = _build_recommendations(
        project,
        roles,
        enabled_ids or set(),
        use_default_selection=enabled_ids is None,
    )
    _attach_conflicts(recommendations)
    return ProjectAnalysis(
        project_id=project.id,
        fields=fields,
        quality=quality,
        recommendations=recommendations,
        fields_confirmed=fields_confirmed,
    )


def infer_role(column: ColumnProfile, sampled_rows: int) -> ColumnRole:
    dtype = column.inferred_type
    unique_rate = column.unique_count / sampled_rows if sampled_rows else 0
    if "Boolean" in dtype:
        return ColumnRole.BOOLEAN
    if "Date" in dtype or "Datetime" in dtype:
        return ColumnRole.DATETIME
    if dtype.startswith(NUMERIC_TYPES):
        if unique_rate <= 0.05 or column.unique_count <= 20:
            return ColumnRole.DISCRETE_NUMERIC
        return ColumnRole.CONTINUOUS_NUMERIC
    if unique_rate >= 0.98 and ID_NAME_PATTERN.search(column.name):
        return ColumnRole.ID
    average_example_length = (
        sum(len(value) for value in column.examples) / len(column.examples)
        if column.examples
        else 0
    )
    if unique_rate >= 0.5 and average_example_length >= 20:
        return ColumnRole.TEXT
    return ColumnRole.NOMINAL_CATEGORY


def _build_quality(project: ProjectRecord, roles: dict[str, ColumnRole]) -> QualityReport:
    assert project.profile is not None
    profile = project.profile
    dimensions = [
        _completeness_dimension(profile.columns, profile.sampled_rows),
        _validity_dimension(profile.columns),
        _consistency_dimension(profile.columns),
        _uniqueness_dimension(profile.columns),
        _structure_dimension(profile.columns, roles),
        _task_readiness_dimension(project, roles),
    ]
    return QualityReport(
        total_score=round(sum(item.score for item in dimensions) / len(dimensions)),
        sampled=profile.is_sampled,
        dimensions=dimensions,
    )


def _completeness_dimension(columns: list[ColumnProfile], rows: int) -> QualityDimension:
    cell_count = rows * len(columns)
    missing = sum(column.missing_count for column in columns)
    score = round(100 * (1 - missing / cell_count)) if cell_count else 0
    deductions = [
        QualityDeduction(
            rule_id="BD-Q-COMP-001",
            column=column.name,
            points=max(1, round(column.missing_rate * 100)),
            reason="字段存在缺失值",
            evidence=f"抽样中缺失 {column.missing_count} 行，占 {column.missing_rate:.1%}",
        )
        for column in columns
        if column.missing_count
    ]
    return QualityDimension(key="completeness", label="完整性", score=score, deductions=deductions)


def _validity_dimension(columns: list[ColumnProfile]) -> QualityDimension:
    deductions = [
        QualityDeduction(
            rule_id="BD-Q-VALID-001",
            column=column.name,
            points=10,
            reason="字段类型无法稳定推断",
            evidence=f"抽样推断类型为 {column.inferred_type}",
        )
        for column in columns
        if column.inferred_type in {"Object", "Unknown"}
    ]
    return QualityDimension(
        key="validity",
        label="有效性",
        score=max(0, 100 - sum(item.points for item in deductions)),
        deductions=deductions,
    )


def _consistency_dimension(columns: list[ColumnProfile]) -> QualityDimension:
    deductions = [
        QualityDeduction(
            rule_id="BD-Q-CONS-001",
            column=column.name,
            points=5,
            reason="字段同时包含缺失和多种非空值",
            evidence=f"抽样中有 {column.unique_count} 个不同值及 {column.missing_count} 个缺失值",
        )
        for column in columns
        if column.missing_count and column.unique_count > 1
    ]
    return QualityDimension(
        key="consistency",
        label="一致性",
        score=max(0, 100 - min(30, sum(item.points for item in deductions))),
        deductions=deductions,
    )


def _uniqueness_dimension(columns: list[ColumnProfile]) -> QualityDimension:
    deductions = [
        QualityDeduction(
            rule_id="BD-Q-UNIQ-001",
            column=column.name,
            points=15,
            reason="字段为常量或全空",
            evidence=f"抽样中仅有 {column.unique_count} 个不同值",
        )
        for column in columns
        if column.unique_count <= 1
    ]
    return QualityDimension(
        key="uniqueness",
        label="唯一性",
        score=max(0, 100 - sum(item.points for item in deductions)),
        deductions=deductions,
    )


def _structure_dimension(
    columns: list[ColumnProfile], roles: dict[str, ColumnRole]
) -> QualityDimension:
    deductions: list[QualityDeduction] = []
    for column in columns:
        if roles[column.name] in {ColumnRole.ID, ColumnRole.TEXT}:
            deductions.append(
                QualityDeduction(
                    rule_id="BD-Q-STRUCT-001",
                    column=column.name,
                    points=5,
                    reason="字段默认不适合直接进入特征矩阵",
                    evidence=f"当前字段角色为 {roles[column.name].value}",
                )
            )
        if column.inferred_type in {"String", "Utf8"} and column.unique_count > 50:
            deductions.append(
                QualityDeduction(
                    rule_id="BD-Q-STRUCT-002",
                    column=column.name,
                    points=8,
                    reason="类别基数较高",
                    evidence=f"抽样中检测到 {column.unique_count} 个不同值",
                )
            )
    return QualityDimension(
        key="structure_usability",
        label="结构可用性",
        score=max(0, 100 - min(45, sum(item.points for item in deductions))),
        deductions=deductions,
    )


def _task_readiness_dimension(
    project: ProjectRecord, roles: dict[str, ColumnRole]
) -> QualityDimension:
    deductions: list[QualityDeduction] = []
    target_count = sum(role == ColumnRole.TARGET for role in roles.values())
    if project.task_type in SUPERVISED_TASKS and target_count != 1:
        deductions.append(
            QualityDeduction(
                rule_id="BD-Q-TASK-001",
                points=35,
                reason="监督学习任务尚未指定唯一目标列",
                evidence=f"当前目标列数量为 {target_count}，要求为 1",
            )
        )
    ignored_count = sum(role in {ColumnRole.IGNORE, ColumnRole.ID, ColumnRole.TEXT} for role in roles.values())
    if ignored_count == len(roles) and roles:
        deductions.append(
            QualityDeduction(
                rule_id="BD-Q-TASK-002",
                points=50,
                reason="没有可用于处理的特征列",
                evidence="所有字段均被标记为 ID、文本或忽略",
            )
        )
    return QualityDimension(
        key="task_readiness",
        label="任务就绪度",
        score=max(0, 100 - sum(item.points for item in deductions)),
        deductions=deductions,
    )


def _build_recommendations(
    project: ProjectRecord,
    roles: dict[str, ColumnRole],
    enabled_ids: set[str],
    *,
    use_default_selection: bool,
) -> list[RuleRecommendation]:
    assert project.profile is not None
    recommendations: list[RuleRecommendation] = []
    target_count = sum(role == ColumnRole.TARGET for role in roles.values())
    if project.task_type in SUPERVISED_TASKS and target_count != 1:
        recommendations.append(
            RuleRecommendation(
                id="BD-TARGET-001:project",
                rule_id="BD-TARGET-001",
                title="指定唯一目标列",
                problem="分类和回归必须明确预测目标，当前配置无法安全进入划分阶段。",
                evidence=f"当前目标列数量为 {target_count}，要求为 1",
                severity=RiskLevel.HIGH,
                risk=RiskLevel.HIGH,
                confidence=1,
                action="configure_target",
                expected_impact="满足监督学习任务的最低配置要求",
                side_effects=["选错目标列会使后续评估失去意义"],
                alternatives=["返回任务配置改为纯数据清洗"],
            )
        )

    for column in project.profile.columns:
        column_id = _recommendation_column_id(column.name)
        role = roles[column.name]
        if column.missing_rate >= 0.5 and role != ColumnRole.TARGET:
            recommendations.append(
                RuleRecommendation(
                    id=f"BD-MISSING-001:{column_id}",
                    rule_id="BD-MISSING-001",
                    title=f"审阅高缺失字段：{column.name}",
                    column=column.name,
                    problem="字段缺失过多，简单填充可能引入明显偏差。",
                    evidence=f"抽样缺失率为 {column.missing_rate:.1%}（阈值 50%）",
                    severity=RiskLevel.HIGH,
                    risk=RiskLevel.HIGH,
                    confidence=0.98,
                    action="remove_column",
                    parameters={"missing_rate_threshold": 0.5},
                    expected_impact="减少高缺失特征对模型和导出的干扰",
                    side_effects=["可能丢失业务上重要但采集困难的信息"],
                    alternatives=["保留字段并添加缺失指示", "采用训练集拟合的简单填充"],
                )
            )
        if column.missing_rate >= 0.1 and role != ColumnRole.TARGET:
            recommendation_id = f"BD-MISSING-002:{column_id}"
            recommendations.append(
                RuleRecommendation(
                    id=recommendation_id,
                    rule_id="BD-MISSING-002",
                    title=f"添加缺失指示：{column.name}",
                    column=column.name,
                    problem="字段缺失本身可能携带采集流程或业务状态信息。",
                    evidence=f"抽样缺失率为 {column.missing_rate:.1%}（触发阈值 10%）",
                    severity=RiskLevel.LOW,
                    risk=RiskLevel.LOW,
                    confidence=0.95,
                    action="add_missing_indicator",
                    expected_impact="保留缺失模式供后续模型使用",
                    side_effects=["会为该字段新增一个布尔特征"],
                    alternatives=["仅执行训练集拟合的填充", "移除高缺失字段"],
                    enabled=recommendation_id in enabled_ids or use_default_selection,
                )
            )
        if column.unique_count <= 1 and role != ColumnRole.TARGET:
            recommendation_id = f"BD-CONSTANT-001:{column_id}"
            recommendations.append(
                RuleRecommendation(
                    id=recommendation_id,
                    rule_id="BD-CONSTANT-001",
                    title=f"移除常量字段：{column.name}",
                    column=column.name,
                    problem="字段在抽样中没有区分度。",
                    evidence=f"抽样中仅有 {column.unique_count} 个不同值",
                    severity=RiskLevel.LOW,
                    risk=RiskLevel.LOW,
                    confidence=0.99,
                    action="remove_column",
                    expected_impact="减少无效特征和输出体积",
                    side_effects=["抽样未必覆盖全量数据中的少数变化"],
                    alternatives=["保留字段并在全量扫描后重新判断"],
                    enabled=recommendation_id in enabled_ids or use_default_selection,
                )
            )
        if role == ColumnRole.ID:
            recommendation_id = f"BD-ID-001:{column_id}"
            recommendations.append(
                RuleRecommendation(
                    id=recommendation_id,
                    rule_id="BD-ID-001",
                    title=f"默认排除 ID 字段：{column.name}",
                    column=column.name,
                    problem="高唯一率标识符通常不能泛化，直接编码可能造成过拟合。",
                    evidence=f"抽样唯一值 {column.unique_count} 个，且字段名符合 ID 模式",
                    severity=RiskLevel.MEDIUM,
                    risk=RiskLevel.LOW,
                    confidence=0.9,
                    action="exclude_feature",
                    expected_impact="降低标识符泄漏和无效高维编码风险",
                    side_effects=["部分业务编号可能包含有用的分组信息"],
                    alternatives=["改为分组字段", "先提取稳定的业务前缀"],
                    enabled=recommendation_id in enabled_ids or use_default_selection,
                )
            )
        if column.inferred_type in {"String", "Utf8"} and column.unique_count > 50:
            recommendations.append(
                RuleRecommendation(
                    id=f"BD-CATEGORY-001:{column_id}",
                    rule_id="BD-CATEGORY-001",
                    title=f"限制高基数类别：{column.name}",
                    column=column.name,
                    problem="直接 One-Hot 编码可能产生过多特征。",
                    evidence=f"抽样中有 {column.unique_count} 个不同值（阈值 50）",
                    severity=RiskLevel.MEDIUM,
                    risk=RiskLevel.MEDIUM,
                    confidence=0.9,
                    action="limit_category_cardinality",
                    parameters={"maximum_categories": 50},
                    expected_impact="控制输出维度和内存需求",
                    side_effects=["合并类别可能损失少数类别信息"],
                    alternatives=["频率编码", "将字段标记为文本并默认忽略"],
                )
            )
    return recommendations


def _attach_conflicts(recommendations: list[RuleRecommendation]) -> None:
    by_column: dict[str, list[RuleRecommendation]] = {}
    for recommendation in recommendations:
        if recommendation.column:
            by_column.setdefault(recommendation.column, []).append(recommendation)
    for items in by_column.values():
        removal = [item for item in items if item.action == "remove_column"]
        transformations = [item for item in items if item.action not in {"remove_column", "exclude_feature"}]
        for left in removal:
            left.conflicts_with = sorted(item.id for item in transformations)
        for right in transformations:
            right.conflicts_with = sorted(item.id for item in removal)


def validate_enabled_recommendations(
    recommendations: list[RuleRecommendation], enabled_ids: set[str]
) -> None:
    known_ids = {item.id for item in recommendations}
    unknown = enabled_ids - known_ids
    if unknown:
        raise ValueError(f"包含未知建议：{', '.join(sorted(unknown))}")
    for recommendation in recommendations:
        if recommendation.id not in enabled_ids:
            continue
        conflicts = enabled_ids.intersection(recommendation.conflicts_with)
        if conflicts:
            raise RecommendationConflictError(
                f"建议 {recommendation.id} 与 {', '.join(sorted(conflicts))} 冲突，请先关闭其中一项"
            )


def _recommendation_column_id(name: str) -> str:
    return name.encode("utf-8").hex()


class RecommendationConflictError(ValueError):
    pass
