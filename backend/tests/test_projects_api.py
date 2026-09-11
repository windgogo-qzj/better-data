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
    settings = Settings(project_library=tmp_path / "projects", profile_sample_rows=3)
    monkeypatch.setattr(main_module, "store", ProjectStore(settings))
    with TestClient(main_module.app) as test_client:
        yield test_client


def test_create_csv_project_streams_source_and_returns_profile(
    client: TestClient,
    tmp_path: Path,
) -> None:
    content = (
        "customer_id,age,city,churned\n"
        "C001,31,上海,false\n"
        "C002,,北京,true\n"
        "C003,44,上海,false\n"
        "C004,28,深圳,false\n"
    ).encode()

    response = client.post(
        "/api/projects",
        data={"name": "客户流失", "task_type": "classification"},
        files={"dataset": ("customers.csv", content, "text/csv")},
    )

    assert response.status_code == 201
    record = response.json()
    assert record["name"] == "客户流失"
    assert record["status"] == "ready"
    assert record["source_size"] == len(content)
    assert record["source_sha256"] == hashlib.sha256(content).hexdigest()
    assert record["profile"]["sampled_rows"] == 3
    assert record["profile"]["is_sampled"] is True
    assert record["profile"]["column_count"] == 4
    assert record["profile"]["preview_rows"][1]["age"] is None
    assert record["profile"]["columns"][1]["missing_count"] == 1
    assert "数据画像基于前 3 行抽样" in record["profile"]["warnings"]

    source = tmp_path / "projects" / record["id"] / "source" / "customers.csv"
    assert source.read_bytes() == content

    listed = client.get("/api/projects")
    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()] == [record["id"]]


def test_project_trash_restore_and_permanent_delete(
    client: TestClient,
    tmp_path: Path,
) -> None:
    created = client.post(
        "/api/projects",
        data={"name": "可恢复项目", "task_type": "cleaning"},
        files={"dataset": ("source.csv", b"name,score\nA,1\n", "text/csv")},
    ).json()
    project_id = created["id"]
    original = tmp_path / "projects" / project_id
    trashed = tmp_path / "projects" / ".trash" / project_id

    moved = client.delete(f"/api/projects/{project_id}")
    assert moved.status_code == 200
    assert moved.json()["id"] == project_id
    assert moved.json()["trashed_at"]
    assert not original.exists()
    assert trashed.is_dir()
    assert client.get("/api/projects").json() == []
    assert [item["id"] for item in client.get("/api/trash").json()] == [project_id]

    restored = client.post(f"/api/trash/{project_id}/restore")
    assert restored.status_code == 200
    assert restored.json()["id"] == project_id
    assert original.is_dir()
    assert not trashed.exists()

    assert client.delete(f"/api/projects/{project_id}").status_code == 200
    deleted = client.delete(f"/api/trash/{project_id}")
    assert deleted.status_code == 204
    assert not trashed.exists()
    assert client.get("/api/trash").json() == []


def test_project_delete_rejects_invalid_or_missing_identifiers(client: TestClient) -> None:
    invalid = client.delete("/api/projects/not-a-project")
    missing = client.delete(f"/api/trash/{'0' * 32}")

    assert invalid.status_code == 404
    assert missing.status_code == 404


def test_csv_with_semicolon_delimiter_is_detected(client: TestClient) -> None:
    response = client.post(
        "/api/projects",
        data={"name": "分号文件", "task_type": "cleaning"},
        files={"dataset": ("semicolon.csv", b"name;score\nA;1\nB;2\n", "text/csv")},
    )

    assert response.status_code == 201
    profile = response.json()["profile"]
    assert profile["column_count"] == 2
    assert "检测到字段分隔符：;" in profile["warnings"]


@pytest.mark.parametrize(
    ("filename", "content", "message"),
    [
        ("empty.csv", b"", "CSV 文件为空"),
        ("blank-header.csv", b"name,,score\nA,x,1\n", "CSV 存在空表头"),
        ("duplicate-header.csv", b"name,name\nA,B\n", "CSV 存在重复表头"),
        ("gbk.csv", "姓名,城市\n张三,上海\n".encode("gbk"), "CSV 必须使用 UTF-8"),
    ],
)
def test_invalid_csv_is_retained_with_clear_failed_record(
    client: TestClient,
    filename: str,
    content: bytes,
    message: str,
) -> None:
    response = client.post(
        "/api/projects",
        data={"name": "错误文件", "task_type": "cleaning"},
        files={"dataset": (filename, content, "text/csv")},
    )

    assert response.status_code == 201
    record = response.json()
    assert record["status"] == "failed"
    assert message in record["error"]
    assert record["profile"] is None


def test_unsupported_extension_is_rejected_without_creating_project(
    client: TestClient,
    tmp_path: Path,
) -> None:
    response = client.post(
        "/api/projects",
        data={"name": "文本", "task_type": "cleaning"},
        files={"dataset": ("notes.txt", b"not,csv", "text/plain")},
    )

    assert response.status_code == 422
    assert "仅支持 CSV 和 XLSX 文件" in response.json()["detail"]
    assert [item.name for item in (tmp_path / "projects").iterdir()] == [
        ".better-data-library.json"
    ]


def test_oversized_upload_is_rejected_and_partial_project_is_removed(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = Settings(project_library=tmp_path / "projects", max_csv_bytes=8)
    monkeypatch.setattr(main_module, "store", ProjectStore(settings))

    with TestClient(main_module.app) as client:
        response = client.post(
            "/api/projects",
            data={"name": "过大文件", "task_type": "cleaning"},
            files={"dataset": ("large.csv", b"name,value\nA,1\n", "text/csv")},
        )

    assert response.status_code == 422
    assert "CSV 文件超过允许大小" in response.json()["detail"]
    assert [item.name for item in (tmp_path / "projects").iterdir()] == [
        ".better-data-library.json"
    ]
