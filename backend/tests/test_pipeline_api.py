from __future__ import annotations

import json
from pathlib import Path

import polars as pl
import pytest
from fastapi.testclient import TestClient
from sklearn.model_selection import train_test_split

import better_data.main as main_module
from better_data.config import Settings
from better_data.services.project_store import ProjectStore


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    settings = Settings(project_library=tmp_path / "projects", profile_sample_rows=100)
    monkeypatch.setattr(main_module, "store", ProjectStore(settings))
    with TestClient(main_module.app) as test_client:
        yield test_client


def _classification_csv() -> bytes:
    rows = ["row_id,amount,segment,target"]
    for index in range(20):
        amount = "" if index == 3 else str(1_000 if index == 19 else index)
        rows.append(f"R{index:03d},{amount},segment-{index},{'yes' if index % 2 else 'no'}")
    rows.append("R020,21,segment-20,")
    return ("\n".join(rows) + "\n").encode()


def _create_project(client: TestClient, task_type: str = "classification") -> dict[str, object]:
    content = _classification_csv()
    if task_type == "regression":
        text = content.decode().replace(",yes\n", ",1.5\n").replace(",no\n", ",0.5\n")
        content = text.encode()
    response = client.post(
        "/api/projects",
        data={"name": "防泄漏流水线", "task_type": task_type},
        files={"dataset": ("pipeline.csv", content, "text/csv")},
    )
    assert response.status_code == 201
    return response.json()


def _confirm_fields(client: TestClient, project: dict[str, object]) -> dict[str, object]:
    roles = {
        "row_id": "id",
        "amount": "continuous_numeric",
        "segment": "nominal_category",
        "target": "target",
    }
    response = client.put(
        f"/api/projects/{project['id']}/fields",
        json={
            "fields": [
                {"name": column["name"], "role": roles[column["name"]]}
                for column in project["profile"]["columns"]
            ]
        },
    )
    assert response.status_code == 200
    return response.json()


def test_pipeline_fits_on_train_only_maps_unknown_and_separates_missing_target(
    client: TestClient,
    tmp_path: Path,
) -> None:
    project = _create_project(client)
    _confirm_fields(client, project)
    config = {
        "test_size": 0.2,
        "random_seed": 7,
        "stratify_classification": True,
        "drop_duplicates": True,
        "drop_constant_features": True,
        "numeric_imputation": "mean",
        "categorical_imputation": "most_frequent",
        "scaling": "none",
        "max_categories": 50,
    }

    response = client.post(
        f"/api/projects/{project['id']}/pipeline-runs",
        json={"config": config},
    )

    assert response.status_code == 201
    result = response.json()
    assert result["train_rows"] == 16
    assert result["test_rows"] == 4
    assert result["target_missing_rows"] == 1
    assert result["stratified"] is True
    assert result["test_unknown_categories"]["segment"] == 4

    labels = ["yes" if index % 2 else "no" for index in range(20)]
    train_indices, _ = train_test_split(
        list(range(20)),
        test_size=0.2,
        random_state=7,
        shuffle=True,
        stratify=labels,
    )
    train_amounts = [1_000 if index == 19 else index for index in train_indices if index != 3]
    expected_train_mean = sum(train_amounts) / len(train_amounts)
    full_mean = sum(1_000 if index == 19 else index for index in range(20) if index != 3) / 19
    learned_mean = result["learned_parameters"]["amount"]["fill_value"]
    assert learned_mean == pytest.approx(expected_train_mean)
    assert learned_mean != pytest.approx(full_mean)

    working = tmp_path / "projects" / project["id"] / "working"
    test_frame = pl.read_parquet(working / "test.parquet")
    assert test_frame.get_column("segment__unknown").to_list() == [1, 1, 1, 1]
    assert pl.read_parquet(working / "target-missing.parquet").height == 1
    state = json.loads((working / "pipeline-state.json").read_text(encoding="utf-8"))
    assert state["source_sha256"] == project["source_sha256"]
    assert client.get(f"/api/projects/{project['id']}").json()["status"] == "processed"


def test_same_seed_produces_same_artifact_hashes(client: TestClient) -> None:
    project = _create_project(client)
    _confirm_fields(client, project)
    payload = {"config": {"random_seed": 42, "scaling": "standard"}}

    first = client.post(f"/api/projects/{project['id']}/pipeline-runs", json=payload)
    second = client.post(f"/api/projects/{project['id']}/pipeline-runs", json=payload)

    assert first.status_code == second.status_code == 201
    first_hashes = {name: item["sha256"] for name, item in first.json()["artifacts"].items()}
    second_hashes = {name: item["sha256"] for name, item in second.json()["artifacts"].items()}
    assert first_hashes == second_hashes
    assert first.json()["learned_parameters"] == second.json()["learned_parameters"]


def test_pipeline_requires_confirmed_fields_and_upstream_change_invalidates_run(
    client: TestClient,
) -> None:
    project = _create_project(client)
    before_confirmation = client.post(
        f"/api/projects/{project['id']}/pipeline-runs",
        json={"config": {}},
    )
    assert before_confirmation.status_code == 422
    assert "先确认字段角色" in before_confirmation.json()["detail"]

    analysis = _confirm_fields(client, project)
    run = client.post(f"/api/projects/{project['id']}/pipeline-runs", json={"config": {}})
    assert run.status_code == 201
    assert client.get(f"/api/projects/{project['id']}/pipeline-runs/latest").status_code == 200

    updated = client.put(
        f"/api/projects/{project['id']}/fields",
        json={"fields": [{"name": item["name"], "role": item["role"]} for item in analysis["fields"]]},
    )
    assert updated.status_code == 200
    assert client.get(f"/api/projects/{project['id']}/pipeline-runs/latest").status_code == 404
    assert client.get(f"/api/projects/{project['id']}").json()["status"] == "ready"


def test_regression_pipeline_validates_numeric_target_and_does_not_stratify(
    client: TestClient,
) -> None:
    project = _create_project(client, "regression")
    _confirm_fields(client, project)

    response = client.post(
        f"/api/projects/{project['id']}/pipeline-runs",
        json={"config": {"random_seed": 11, "scaling": "minmax"}},
    )

    assert response.status_code == 201
    result = response.json()
    assert result["stratified"] is False
    assert result["learned_parameters"]["amount"]["scaling"] == "minmax"
