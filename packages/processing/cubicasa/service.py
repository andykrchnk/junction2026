"""Private HTTP boundary for the CubiCasa inference pipeline."""

import asyncio
import hmac
import io
import json
import secrets
import urllib.error
import urllib.request
import os
import shutil
import tempfile
import warnings
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal
from zipfile import ZIP_DEFLATED, ZipFile

from fastapi import FastAPI, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from PIL import Image, UnidentifiedImageError
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool

from adapters import load_adapter

MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_IMAGE_PIXELS = 40_000_000
Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS


@asynccontextmanager
async def lifespan(app: FastAPI):
    api_key = os.environ.get("INFERENCE_API_KEY", "")
    if len(api_key) < 32 or not api_key.isascii():
        raise RuntimeError(
            "INFERENCE_API_KEY must contain at least 32 ASCII characters"
        )
    device = os.environ.get("INFERENCE_DEVICE", "auto")
    if device not in {"auto", "cpu", "mps", "cuda"}:
        raise RuntimeError("INFERENCE_DEVICE must be auto, cpu, mps or cuda")
    app.state.api_key = api_key
    app.state.inference_lock = asyncio.Lock()
    local_model = os.environ.get("INFERENCE_LOCAL_MODEL", "cubicasa")
    app.state.local_model = local_model
    app.state.segmentor = await run_in_threadpool(
        load_adapter, local_model, None if device == "auto" else device
    )
    # Deployment-owned allowlist: request values can never become arbitrary URLs.
    app.state.backends = {
        name: url
        for name, url in {
            "cubicasa-detail": os.environ.get("CUBICASA_DETAIL_URL"),
            "paddleocr": os.environ.get("PADDLEOCR_URL"),
        }.items()
        if url
    }
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
                return JSONResponse(
                    {"detail": "Invalid Content-Length"}, status_code=400
                )
            if too_large:
                return JSONResponse({"detail": "Upload too large"}, status_code=413)
    return await call_next(request)


@app.get("/health/live")
def live():
    return {"status": "alive"}


@app.get("/health/ready")
def ready(request: Request):
    return {
        "status": "ready",
        "device": request.app.state.segmentor.device,
        "local_model": request.app.state.local_model,
        "configured_backends": list(request.app.state.backends),
    }


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


def predict(segmentor, data: bytes, response_format: str):
    validate_image(data)
    directory = Path(tempfile.mkdtemp(prefix="cubicasa-"))
    try:
        source = directory / "drawing.png"
        with Image.open(io.BytesIO(data)) as image:
            image.convert("RGB").save(source)
        summary, output = segmentor.run(
            source, directory / "output", response_format == "zip"
        )
        if response_format == "json":
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


def proxy_prediction(
    url: str, api_key: str, data: bytes, response_format: str, model: str
):
    validate_image(data)
    # Neither boundary nor filename contains client-controlled text.
    boundary = "junction-" + secrets.token_hex(16)
    body = (
        (
            f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="drawing.png"\r\n'
            "Content-Type: application/octet-stream\r\n\r\n"
        ).encode()
        + data
        + f"\r\n--{boundary}--\r\n".encode()
    )
    upstream = urllib.request.Request(
        url.rstrip("/")
        + f"/v1/predictions?model={model}&response_format={response_format}",
        data=body,
        headers={
            "X-API-Key": api_key,
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
    )

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None

    try:
        with urllib.request.build_opener(NoRedirect).open(
            upstream, timeout=180
        ) as response:
            payload = response.read(256 * 1024 * 1024 + 1)
            if len(payload) > 256 * 1024 * 1024:
                raise HTTPException(502, "Model response too large")
            if response_format == "json":
                summary = json.loads(payload)
                if (
                    not isinstance(summary, dict)
                    or not isinstance(summary.get("model"), dict)
                    or summary["model"].get("name") != model
                ):
                    raise HTTPException(502, "Unexpected model response")
                return JSONResponse(summary)
            return Response(
                payload,
                media_type="application/zip",
                headers={
                    "Content-Disposition": 'attachment; filename="prediction.zip"'
                },
            )
    except urllib.error.HTTPError as error:
        code = error.code if error.code in {413, 415, 422, 503} else 502
        raise HTTPException(
            code,
            "Model worker rejected inference",
            headers={"Retry-After": "5"} if code == 503 else None,
        ) from error
    except (urllib.error.URLError, TimeoutError, ValueError) as error:
        raise HTTPException(
            502, "Model worker unavailable or returned invalid data"
        ) from error


@app.post("/v1/predictions")
async def predictions(
    request: Request,
    image: UploadFile,
    response_format: Literal["json", "zip"] = "json",
    model: Literal[
        "cubicasa",
        "cubicasa-detail",
        "paddleocr",
    ] = "cubicasa",
):
    lock = request.app.state.inference_lock
    if lock.locked():
        raise HTTPException(
            503, "Inference busy; retry later", headers={"Retry-After": "5"}
        )
    async with lock:
        try:
            data = await image.read(MAX_UPLOAD_BYTES + 1)
            if len(data) > MAX_UPLOAD_BYTES:
                raise HTTPException(413, "Upload exceeds 25 MiB")
            if model == request.app.state.local_model:
                return await run_in_threadpool(
                    predict, request.app.state.segmentor, data, response_format
                )
            backend = request.app.state.backends.get(model)
            if backend is None:
                raise HTTPException(
                    503, "Selected model is not available for raster inference"
                )
            return await run_in_threadpool(
                proxy_prediction,
                backend,
                request.app.state.api_key,
                data,
                response_format,
                model,
            )
        finally:
            await image.close()
