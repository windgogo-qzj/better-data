from __future__ import annotations

from pathlib import Path

import polars as pl
import pytest
from fastapi.testclient import TestClient

import better_data.main as main_module
from better_data.config import Settings
from better_data.services.project_store import ProjectStore


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    settings = Settings(project_library=tmp_path / "projects", profile_sample_rows=100)
    monkeypatch.setattr(main_module, "store", ProjectStore(settings))
    with TestClient(main_module.app) as test_client:
        yield test_client


def _prepared_cleaning_project(client: TestClient) -> tuple[dict[str, object], dict[str, object]]:
    content = (
        "record_id,amount,city,note\n"
        "A,1,上海,首行\n"
        "B,,北京,缺失\n"
        "B,,北京,缺失\n"
        "C,3,上海,正常\n"
        "D,4,深圳,正常\n"
    ).encode()
    created = client.post(
        "/api/projects",
        data={"name": "全量清洗", "task_type": "cleaning"},
        files={"dataset": ("cleaning.csv", content, "text/csv")},
    )
    assert created.status_code == 201
    project = created.json()
    roles = {
        "record_id": "id",
        "amount": "continuous_numeric",
        "city": "nominal_category",
        "note": "ignore",
    }
    fields = [
        {"name": column["name"], "role": roles[column["name"]]}
        for column in project["profile"]["columns"]
    ]
    confirmed = client.put(
        f"/api/projects/{project['id']}/fields", json={"fields": fields}
    )
    assert confirmed.status_code == 200
    return project, confirmed.json()


def test_cleaning_runs_on_full_data_without_target_or_split(
    client: TestClient,
    tmp_path: Path,
) -> None:
    project, _ = _prepared_cleaning_project(client)

    response = client.post(
        f"/api/projects/{project['id']}/pipeline-runs",
        json={"config": {"drop_duplicates": True, "scaling": "none"}},
    )

    assert response.status_code == 201
    run = response.json()
    assert run["target_column"] is None
    assert run["train_rows"] == run["test_rows"] == 0
    assert run["full_rows"] == 4
    assert set(run["artifacts"]) == {"processed"}
    working = tmp_path / "projects" / project["id"] / "working"
    processed = pl.read_parquet(working / "processed.parquet")
    assert processed.height == 4
    assert "amount__is_missing" in processed.columns
    assert not (working / "train.parquet").exists()


def test_cleaning_exports_single_csv_and_upstream_change_invalidates_it(
    client: TestClient,
    tmp_path: Path,
) -> None:
    project, analysis = _prepared_cleaning_project(client)
    project_id = project["id"]
    assert client.post(f"/api/projects/{project_id}/pipeline-runs", json={"config": {}}).status_code == 201

    quick = client.post(f"/api/projects/{project_id}/evaluation", json={"mode": "quick"})
    assert quick.status_code == 422
    assert "选择关闭档" in quick.json()["detail"]

    exported = client.post(f"/api/projects/{project_id}/evaluation", json={"mode": "off"})
    assert exported.status_code == 201
    result = exported.json()
    assert result["full_rows"] == 4
    assert set(result["artifacts"]) == {"processed_csv", "report_html"}
    csv_file = tmp_path / "projects" / project_id / "exports" / "processed.csv"
    assert csv_file.read_bytes().startswith(b"\xef\xbb\xbf")
    assert client.get(f"/api/projects/{project_id}/artifacts/processed-csv").status_code == 200

    updated = client.put(
        f"/api/projects/{project_id}/fields",
        json={
            "fields": [
                {"name": field["name"], "role": field["role"]}
                for field in analysis["fields"]
            ]
        },
    )
    assert updated.status_code == 200
    assert not csv_file.exists()
    assert client.get(f"/api/projects/{project_id}/pipeline-runs/latest").status_code == 404
    assert client.get(f"/api/projects/{project_id}/evaluation").status_code == 404
