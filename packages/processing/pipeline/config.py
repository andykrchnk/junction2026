import os
from dataclasses import dataclass, field
from pathlib import Path
from threading import BoundedSemaphore


@dataclass(frozen=True)
class Settings:
    api_key: str
    gemini_key: str
    geometry_url: str
    ocr_url: str
    legacy_url: str
    artifact_dir: Path
    model: str = "gemini-decision-1"
    max_targets: int = 500
    concurrency: int = 15
    gemini_workers: int = 8
    gemini_slots: BoundedSemaphore = field(init=False, repr=False, compare=False)
    gemini_timeout: float = 30
    deadline_seconds: float = 180

    def __post_init__(self):
        object.__setattr__(self, "gemini_slots", BoundedSemaphore(self.gemini_workers))

    @classmethod
    def load(cls):
        key = os.environ.get("INFERENCE_API_KEY", "")
        if not key.isascii() or len(key) < 32:
            raise RuntimeError("INFERENCE_API_KEY must be at least 32 ASCII characters")
        secret_path = os.environ.get("GEMINI_API_KEY_FILE")
        gemini = (
            Path(secret_path).read_text().strip()
            if secret_path
            else os.environ.get("GEMINI_API_KEY", "")
        )
        if not gemini:
            raise RuntimeError(
                "Gemini credential required; configure GEMINI_API_KEY_FILE"
            )
        try:
            workers = int(os.environ.get("PIPELINE_GEMINI_WORKERS", "8"))
        except ValueError:
            raise RuntimeError(
                "PIPELINE_GEMINI_WORKERS must be an integer from 1 to 16"
            ) from None
        if not 1 <= workers <= 16:
            raise RuntimeError("PIPELINE_GEMINI_WORKERS must be an integer from 1 to 16")
        try:
            concurrency = int(os.environ.get("PIPELINE_CONCURRENCY", "15"))
        except ValueError:
            raise RuntimeError(
                "PIPELINE_CONCURRENCY must be an integer from 1 to 32"
            ) from None
        if not 1 <= concurrency <= 32:
            raise RuntimeError("PIPELINE_CONCURRENCY must be an integer from 1 to 32")
        return cls(
            key,
            gemini,
            os.environ.get("CUBICASA_DETAIL_URL", "http://cubicasa-detail:8001"),
            os.environ.get("PADDLEOCR_URL", "http://paddleocr:8001"),
            os.environ.get("LEGACY_INFERENCE_URL", "http://inference:8001"),
            Path(os.environ.get("PIPELINE_ARTIFACT_DIR", "/artifacts")),
            concurrency=concurrency,
            gemini_workers=workers,
        )
