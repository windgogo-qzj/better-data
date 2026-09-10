from __future__ import annotations

import hashlib
from pathlib import Path

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


def _dataset(task_type: str) -> bytes:
    rows = ["row_id,amount,segment,target"]
    for index in range(30):
        amount = "" if index in {3, 14} else str(index * 1.5)
        target = str(index * 2.25 + 1) if task_type == "regression" else ("yes" if index % 2 else "no")
        rows.append(f"R{index:03d},{amount},group-{index % 4},{target}")
    return ("\n".join(rows) + "\n").encode()


def _prepared_project(client: TestClient, task_type: str = "classification") -> tuple[dict[str, object], dict[str, object]]:
    response = client.post(
        "/api/projects",
        data={"name": "<script>客户评估</script>", "task_type": task_type},
        files={"dataset": ("evaluation.csv", _dataset(task_type), "text/csv")},
    )
    assert response.status_code == 201
    project = response.json()
    role_map = {
        "row_id": "id",
        "amount": "continuous_numeric",
        "segment": "nominal_category",
        "target": "target",
    }
    fields = [
        {"name": column["name"], "role": role_map[column["name"]]}
        for column in project["profile"]["columns"]
    ]
    assert client.put(f"/api/projects/{project['id']}/fields", json={"fields": fields}).status_code == 200
    pipeline = client.post(
        f"/api/projects/{project['id']}/pipeline-runs",
        json={"config": {"random_seed": 23, "test_size": 0.2}},
    )
    assert pipeline.status_code == 201
    return project, pipeline.json()


def test_classification_evaluation_uses_same_split_and_exports_offline_files(
    client: TestClient,
    tmp_path: Path,
) -> None:
    project, pipeline = _prepared_project(client)

    response = client.post(
        f"/api/projects/{project['id']}/evaluation",
        json={"mode": "quick"},
    )

    assert response.status_code == 201
    result = response.json()
    assert result["same_split"] is True
    assert result["random_seed"] == 23
    assert result["train_rows"] == pipeline["train_rows"]
    assert result["test_rows"] == pipeline["test_rows"]
    assert set(result["baseline"]["metrics"]) == {"accuracy", "balanced_accuracy", "f1_weighted"}
    assert set(result["complete"]["metrics"]) == {"accuracy", "balanced_accuracy", "f1_weighted"}

    project_root = tmp_path / "projects" / project["id"]
    train_csv = project_root / "exports" / "train.csv"
    test_csv = project_root / "exports" / "test.csv"
    report = project_root / "reports" / "report.html"
    assert train_csv.read_bytes().startswith(b"\xef\xbb\xbf")
    assert test_csv.read_bytes().startswith(b"\xef\xbb\xbf")
    report_text = report.read_text(encoding="utf-8")
    assert "<meta charset=\"utf-8\">" in report_text
    assert "default-src 'none'" in report_text
    assert "http://" not in report_text and "https://" not in report_text
    assert "<script>客户评估</script>" not in report_text
    assert "&lt;script&gt;客户评估&lt;/script&gt;" in report_text
    assert result["artifacts"]["report_html"]["sha256"] == hashlib.sha256(report.read_bytes()).hexdigest()


def test_downloads_use_fixed_artifact_allowlist(client: TestClient) -> None:
    project, _ = _prepared_project(client)
    client.post(f"/api/projects/{project['id']}/evaluation", json={"mode": "quick"})

    report = client.get(f"/api/projects/{project['id']}/artifacts/report")
    train = client.get(f"/api/projects/{project['id']}/artifacts/train-csv")
    unknown = client.get(f"/api/projects/{project['id']}/artifacts/project-json")

    assert report.status_code == 200
    assert "text/html" in report.headers["content-type"]
    assert train.status_code == 200 and train.content.startswith(b"\xef\xbb\xbf")
    assert unknown.status_code == 404


def test_regression_quick_evaluation_and_evaluation_off_mode(client: TestClient) -> None:
    project, _ = _prepared_project(client, "regression")
    quick = client.post(f"/api/projects/{project['id']}/evaluation", json={"mode": "quick"})

    assert quick.status_code == 201
    assert set(quick.json()["baseline"]["metrics"]) == {"mae", "rmse", "r2"}
    assert set(quick.json()["complete"]["metrics"]) == {"mae", "rmse", "r2"}

    disabled = client.post(f"/api/projects/{project['id']}/evaluation", json={"mode": "off"})
    assert disabled.status_code == 201
    assert disabled.json()["baseline"] is None
    assert disabled.json()["complete"] is None
    assert set(disabled.json()["artifacts"]) == {"train_csv", "test_csv", "report_html"}


def test_new_pipeline_run_invalidates_previous_evaluation(client: TestClient) -> None:
    project, _ = _prepared_project(client)
    assert client.post(f"/api/projects/{project['id']}/evaluation", json={"mode": "quick"}).status_code == 201
    assert client.get(f"/api/projects/{project['id']}/evaluation").status_code == 200

    rerun = client.post(
        f"/api/projects/{project['id']}/pipeline-runs",
        json={"config": {"random_seed": 99}},
    )
    assert rerun.status_code == 201
    assert client.get(f"/api/projects/{project['id']}/evaluation").status_code == 404
