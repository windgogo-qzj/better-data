from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import better_data.main as main_module
from better_data.config import Settings
from better_data.services.project_store import ProjectStore


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        project_library=tmp_path / "default-projects",
        config_file=tmp_path / "app-settings.json",
    )


@pytest.fixture
def client(settings: Settings, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setattr(main_module, "store", ProjectStore(settings))
    with TestClient(main_module.app) as test_client:
        yield test_client


def test_first_run_reports_default_library_needs_confirmation(
    client: TestClient,
    settings: Settings,
) -> None:
    response = client.get("/api/settings/project-library")

    assert response.status_code == 200
    assert response.json() == {
        "path": str(settings.project_library),
        "exists": True,
        "writable": True,
        "project_count": 0,
        "needs_setup": True,
    }
    marker = settings.project_library / ".better-data-library.json"
    assert json.loads(marker.read_text(encoding="utf-8"))["kind"] == "better-data-project-library"


def test_selected_library_is_persisted_and_restored(
    client: TestClient,
    settings: Settings,
    tmp_path: Path,
) -> None:
    selected = tmp_path / "my-better-data-library"

    response = client.put(
        "/api/settings/project-library",
        json={"path": str(selected)},
    )

    assert response.status_code == 200
    assert response.json()["path"] == str(selected)
    assert response.json()["needs_setup"] is False
    assert (selected / ".better-data-library.json").is_file()
    assert json.loads(settings.config_file.read_text(encoding="utf-8")) == {
        "schema_version": 1,
        "project_library": str(selected),
    }

    restarted = ProjectStore(settings)
    restarted.initialize()
    assert restarted.root == selected
    assert restarted.needs_setup is False


def test_new_projects_are_created_in_selected_library(
    client: TestClient,
    tmp_path: Path,
) -> None:
    selected = tmp_path / "selected"
    assert client.put(
        "/api/settings/project-library",
        json={"path": str(selected)},
    ).status_code == 200

    created = client.post(
        "/api/projects",
        data={"name": "新项目", "task_type": "cleaning"},
        files={"dataset": ("data.csv", b"name,value\nA,1\n", "text/csv")},
    )

    assert created.status_code == 201
    project_id = created.json()["id"]
    assert (selected / project_id / "source" / "data.csv").is_file()

    detail = client.get(f"/api/projects/{project_id}")
    assert detail.status_code == 200
    assert detail.json()["id"] == project_id
    assert client.get("/api/projects/not-a-project").status_code == 404


@pytest.mark.parametrize("path", ["relative/path", "projects"])
def test_relative_library_path_is_rejected(client: TestClient, path: str) -> None:
    response = client.put("/api/settings/project-library", json={"path": path})

    assert response.status_code == 422
    assert "绝对路径" in response.json()["detail"]


def test_non_empty_unmarked_folder_is_rejected(
    client: TestClient,
    tmp_path: Path,
) -> None:
    unrelated = tmp_path / "documents"
    unrelated.mkdir()
    (unrelated / "notes.txt").write_text("不要覆盖", encoding="utf-8")

    response = client.put(
        "/api/settings/project-library",
        json={"path": str(unrelated)},
    )

    assert response.status_code == 422
    assert "不是空文件夹" in response.json()["detail"]
    assert (unrelated / "notes.txt").read_text(encoding="utf-8") == "不要覆盖"
    assert not (unrelated / ".better-data-library.json").exists()
