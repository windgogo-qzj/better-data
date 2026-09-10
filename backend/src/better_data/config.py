from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    project_library: Path
    max_csv_bytes: int = 1024 * 1024 * 1024
    max_xlsx_bytes: int = 200 * 1024 * 1024
    profile_sample_rows: int = 10_000

    @classmethod
    def from_environment(cls) -> "Settings":
        configured = os.getenv("BETTER_DATA_LIBRARY")
        library = Path(configured) if configured else Path.cwd() / "work" / "projects"
        return cls(project_library=library.resolve())


settings = Settings.from_environment()
