"""Private HTTP boundary for the CubiCasa inference pipeline."""

import asyncio
import hmac
import io
import os
import shutil
import tempfile
import warnings
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal
from zipfile import ZIP_DEFLATED, ZipFile

from fastapi import FastAPI, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from PIL import Image, UnidentifiedImageError
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool

from inference import FloorPlanSegmentor, _result_to_json

# Model selection and preprocessing are versioned with application code.
CHECKPOINT = Path(__file__).parent / "weights" / "cubicasa5k.pkl"
FIXED_SIZE = (1024, 1024)
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_IMAGE_PIXELS = 40_000_000
Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS


@asynccontextmanager
async def lifespan(app: FastAPI):
    api_key = os.environ.get("INFERENCE_API_KEY", "")
    if len(api_key) < 32 or not api_key.isascii():
        raise RuntimeError("INFERENCE_API_KEY must contain at least 32 ASCII characters")
    device = os.environ.get("INFERENCE_DEVICE", "auto")
    if device not in {"auto", "cpu", "mps", "cuda"}:
        raise RuntimeError("INFERENCE_DEVICE must be auto, cpu, mps or cuda")
    app.state.api_key = api_key
    app.state.inference_lock = asyncio.Lock()
    app.state.segmentor = await run_in_threadpool(
        FloorPlanSegmentor,
        str(CHECKPOINT),
        device=None if device == "auto" else device,
        fixed_size=FIXED_SIZE,
    )
    yield
    del app.state.segmentor


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware("http")
async def authenticate(request: Request, call_next):
    if request.url.path == "/v1/predictions":
        supplied_key = request.headers.get("x-api-key", "")
        if not hmac.compare_digest(
            supplied_key.encode(), request.app.state.api_key.encode()
        ):
            return JSONResponse({"detail": "Invalid API key"}, status_code=401)
        content_length = request.headers.get("content-length")
        if content_length is not None:
            try:
                too_large = int(content_length) > MAX_UPLOAD_BYTES + 1024 * 1024
            except ValueError:
                return JSONResponse({"detail": "Invalid Content-Length"}, status_code=400)
            if too_large:
                return JSONResponse({"detail": "Upload too large"}, status_code=413)
    return await call_next(request)


@app.get("/health/live")
def live():
    return {"status": "alive"}


@app.get("/health/ready")
def ready(request: Request):
    return {"status": "ready", "device": request.app.state.segmentor.device}


def validate_image(data: bytes) -> None:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as image:
                if image.format not in {"PNG", "JPEG", "TIFF", "BMP", "WEBP"}:
                    raise HTTPException(415, "Unsupported image format")
                if image.width * image.height > MAX_IMAGE_PIXELS:
                    raise HTTPException(413, "Image exceeds 40 million pixels")
                image.verify()
    except (Image.DecompressionBombWarning, Image.DecompressionBombError) as error:
        raise HTTPException(413, "Image dimensions too large") from error
    except (UnidentifiedImageError, OSError, SyntaxError) as error:
        raise HTTPException(422, "Invalid image") from error


def predict(segmentor: FloorPlanSegmentor, data: bytes, response_format: str):
    validate_image(data)
    directory = Path(tempfile.mkdtemp(prefix="cubicasa-"))
    try:
        source = directory / "drawing.png"
        with Image.open(io.BytesIO(data)) as image:
            image.convert("RGB").save(source)
        result, output = segmentor.predict_and_save(
            source,
            directory / "output",
            save_vis=False,
            save_probabilities=response_format == "zip",
        )
        if response_format == "json":
            summary = _result_to_json(result, probability_file=None)
            summary["device"] = segmentor.device
            return JSONResponse(summary)
        archive_path = directory / "prediction.zip"
        with ZipFile(archive_path, "w", ZIP_DEFLATED) as archive:
            for artifact in output.iterdir():
                archive.write(artifact, artifact.name)
        response = FileResponse(
            archive_path,
            media_type="application/zip",
            filename="prediction.zip",
            background=BackgroundTask(shutil.rmtree, directory),
        )
        directory = None
        return response
    finally:
        if directory is not None:
            shutil.rmtree(directory)


@app.post("/v1/predictions")
async def predictions(
    request: Request,
    image: UploadFile,
    response_format: Literal["json", "zip"] = "json",
):
    lock = request.app.state.inference_lock
    if lock.locked():
        raise HTTPException(503, "Inference busy; retry later", headers={"Retry-After": "5"})
    async with lock:
        try:
            data = await image.read(MAX_UPLOAD_BYTES + 1)
            if len(data) > MAX_UPLOAD_BYTES:
                raise HTTPException(413, "Upload exceeds 25 MiB")
            return await run_in_threadpool(
                predict, request.app.state.segmentor, data, response_format
            )
        finally:
            await image.close()
