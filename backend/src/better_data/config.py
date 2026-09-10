from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    project_library: Path
    config_file: Path | None = None
    project_library_configured: bool = False
    max_csv_bytes: int = 1024 * 1024 * 1024
    max_xlsx_bytes: int = 200 * 1024 * 1024
    profile_sample_rows: int = 10_000

    @classmethod
    def from_environment(cls) -> "Settings":
        configured = os.getenv("BETTER_DATA_LIBRARY")
        data_home = Path(os.getenv("BETTER_DATA_HOME", Path.cwd() / "work")).resolve()
        library = Path(configured) if configured else data_home / "projects"
        return cls(
            project_library=library.resolve(),
            config_file=data_home / "app-settings.json",
            project_library_configured=bool(configured),
        )


settings = Settings.from_environment()
