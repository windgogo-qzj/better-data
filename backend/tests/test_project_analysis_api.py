from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import better_data.main as main_module
from better_data.config import Settings
from better_data.services.project_store import ProjectStore


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    settings = Settings(project_library=tmp_path / "projects", profile_sample_rows=10)
    monkeypatch.setattr(main_module, "store", ProjectStore(settings))
    with TestClient(main_module.app) as test_client:
        yield test_client


def _create_classification_project(client: TestClient) -> dict[str, object]:
    content = (
        "customer_id,age,constant,mostly_missing,churn\n"
        "C001,20,x,,yes\n"
        "C002,,x,,no\n"
        "C003,40,x,,yes\n"
        "C004,30,x,value,no\n"
    ).encode()
    response = client.post(
        "/api/projects",
        data={"name": "字段分析", "task_type": "classification"},
        files={"dataset": ("analysis.csv", content, "text/csv")},
    )
    assert response.status_code == 201
    return response.json()


def test_analysis_infers_roles_scores_six_dimensions_and_traces_rules(
    client: TestClient,
) -> None:
    project = _create_classification_project(client)

    response = client.get(f"/api/projects/{project['id']}/analysis")

    assert response.status_code == 200
    analysis = response.json()
    roles = {field["name"]: field["role"] for field in analysis["fields"]}
    assert roles["customer_id"] == "id"
    assert analysis["fields_confirmed"] is False
    assert len(analysis["quality"]["dimensions"]) == 6
    assert {item["key"] for item in analysis["quality"]["dimensions"]} == {
        "completeness",
        "validity",
        "consistency",
        "uniqueness",
        "structure_usability",
        "task_readiness",
    }

    recommendations = {item["rule_id"]: item for item in analysis["recommendations"]}
    assert recommendations["BD-TARGET-001"]["enabled"] is False
    assert recommendations["BD-ID-001"]["confidence"] == 0.9
    assert recommendations["BD-CONSTANT-001"]["enabled"] is True
    assert "抽样" in recommendations["BD-MISSING-001"]["evidence"]
    assert recommendations["BD-MISSING-002"]["id"] in recommendations["BD-MISSING-001"]["conflicts_with"]


def test_field_roles_require_exact_schema_and_one_target(client: TestClient) -> None:
    project = _create_classification_project(client)
    project_id = project["id"]

    missing_target = client.put(
        f"/api/projects/{project_id}/fields",
        json={
            "fields": [
                {"name": column["name"], "role": "nominal_category"}
                for column in project["profile"]["columns"]
            ]
        },
    )
    assert missing_target.status_code == 422
    assert "必须且只能指定一个目标列" in missing_target.json()["detail"]

    valid_fields = []
    for column in project["profile"]["columns"]:
        role = "target" if column["name"] == "churn" else "nominal_category"
        valid_fields.append({"name": column["name"], "role": role})
    response = client.put(
        f"/api/projects/{project_id}/fields",
        json={"fields": valid_fields},
    )

    assert response.status_code == 200
    analysis = response.json()
    assert analysis["fields_confirmed"] is True
    assert sum(field["role"] == "target" for field in analysis["fields"]) == 1
    assert all(item["rule_id"] != "BD-TARGET-001" for item in analysis["recommendations"])


def test_recommendation_selection_persists_and_conflicts_return_409(
    client: TestClient,
) -> None:
    project = _create_classification_project(client)
    project_id = project["id"]
    analysis = client.get(f"/api/projects/{project_id}/analysis").json()
    removal = next(item for item in analysis["recommendations"] if item["rule_id"] == "BD-MISSING-001")
    indicator = next(
        item
        for item in analysis["recommendations"]
        if item["rule_id"] == "BD-MISSING-002" and item["column"] == removal["column"]
    )

    conflict = client.put(
        f"/api/projects/{project_id}/recommendations",
        json={"enabled_ids": [removal["id"], indicator["id"]]},
    )
    assert conflict.status_code == 409
    assert "冲突" in conflict.json()["detail"]

    saved = client.put(
        f"/api/projects/{project_id}/recommendations",
        json={"enabled_ids": [removal["id"]]},
    )
    assert saved.status_code == 200
    enabled = [item["id"] for item in saved.json()["recommendations"] if item["enabled"]]
    assert enabled == [removal["id"]]

    reloaded = client.get(f"/api/projects/{project_id}/analysis")
    assert [
        item["id"] for item in reloaded.json()["recommendations"] if item["enabled"]
    ] == [removal["id"]]


def test_unknown_project_analysis_returns_404(client: TestClient) -> None:
    response = client.get(f"/api/projects/{'0' * 32}/analysis")

    assert response.status_code == 404
