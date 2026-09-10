from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from better_data import __version__
from better_data.config import settings
from better_data.models import (
    HealthResponse,
    FieldConfigurationUpdate,
    ProjectAnalysis,
    ProjectLibraryInfo,
    ProjectLibraryUpdate,
    ProjectRecord,
    RecommendationSelectionUpdate,
    TaskType,
)
from better_data.services.project_store import ProjectStore
from better_data.services.analysis import RecommendationConflictError

store = ProjectStore(settings)


@asynccontextmanager
async def lifespan(_: FastAPI):
    store.initialize()
    yield


app = FastAPI(
    title="Better Data Local API",
    version=__version__,
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT"],
    allow_headers=["Content-Type", "X-Better-Data-Token"],
)


@app.get("/api/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status="ok", version=__version__, offline=True)


@app.get("/api/projects", response_model=list[ProjectRecord])
def list_projects() -> list[ProjectRecord]:
    return store.list()


@app.get("/api/projects/{project_id}", response_model=ProjectRecord)
def get_project(project_id: str) -> ProjectRecord:
    try:
        return store.get(project_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="项目不存在") from exc
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/projects/{project_id}/analysis", response_model=ProjectAnalysis)
def get_project_analysis(project_id: str) -> ProjectAnalysis:
    try:
        return store.get_analysis(project_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="项目不存在") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.put("/api/projects/{project_id}/fields", response_model=ProjectAnalysis)
def update_project_fields(
    project_id: str, update: FieldConfigurationUpdate
) -> ProjectAnalysis:
    try:
        return store.update_fields(project_id, update)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="项目不存在") from exc
    except RecommendationConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.put("/api/projects/{project_id}/recommendations", response_model=ProjectAnalysis)
def update_project_recommendations(
    project_id: str, update: RecommendationSelectionUpdate
) -> ProjectAnalysis:
    try:
        return store.update_recommendations(project_id, update)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="项目不存在") from exc
    except RecommendationConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/api/settings/project-library", response_model=ProjectLibraryInfo)
def get_project_library() -> ProjectLibraryInfo:
    return ProjectLibraryInfo.model_validate(store.library_info())


@app.put("/api/settings/project-library", response_model=ProjectLibraryInfo)
def update_project_library(update: ProjectLibraryUpdate) -> ProjectLibraryInfo:
    try:
        return ProjectLibraryInfo.model_validate(store.set_library(update.path))
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/api/projects", response_model=ProjectRecord, status_code=201)
async def create_project(
    name: str = Form(default=""),
    task_type: TaskType = Form(),
    dataset: UploadFile = File(),
) -> ProjectRecord:
    try:
        return await store.create(name, task_type, dataset)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
