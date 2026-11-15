"""Single authenticated HTTP entrypoint. GPU dependencies remain in private workers."""

import asyncio
import hmac
import io
import json
import warnings
from contextlib import asynccontextmanager
from zipfile import ZipFile, ZIP_DEFLATED
from typing import Literal
import httpx
from fastapi import FastAPI, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, Response
from PIL import Image, UnidentifiedImageError
from starlette.concurrency import run_in_threadpool
from config import Settings
from pipeline import process
from schemas import ProcessingResponse
from clients.workers import WorkerFailure

MAX_BYTES = 25 * 1024 * 1024
MAX_PIXELS = 40_000_000
Image.MAX_IMAGE_PIXELS = MAX_PIXELS


@asynccontextmanager
async def lifespan(app):
    app.state.settings = Settings.load()
    app.state.settings.artifact_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    app.state.capacity = asyncio.Semaphore(app.state.settings.concurrency)
    yield


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


class Boundary:
    """Authenticate and limit actual body bytes before multipart parsing/spooling."""

    def __init__(self, application):
        self.application = application

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope["path"].startswith("/v1/"):
            return await self.application(scope, receive, send)
        headers = dict(scope["headers"])
        expected = app.state.settings.api_key.encode()
        if not hmac.compare_digest(headers.get(b"x-api-key", b""), expected):
            return await JSONResponse({"detail": "Invalid API key"}, 401)(
                scope, receive, send
            )
        if scope["method"] == "POST":
            data = bytearray()
            while True:
                event = await receive()
                if event["type"] == "http.disconnect":
                    return
                data.extend(event.get("body", b""))
                if len(data) > MAX_BYTES + 1024 * 1024:
                    return await JSONResponse({"detail": "Upload too large"}, 413)(
                        scope, receive, send
                    )
                if not event.get("more_body"):
                    break
            delivered = False

            async def replay():
                nonlocal delivered
                if not delivered:
                    delivered = True
                    return {
                        "type": "http.request",
                        "body": bytes(data),
                        "more_body": False,
                    }
                return await receive()

            return await self.application(scope, replay, send)
        return await self.application(scope, receive, send)


@app.get("/health/live")
def live():
    return {"status": "alive"}


@app.get("/health/ready")
async def ready(request: Request):
    settings = request.app.state.settings
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            for url in [settings.geometry_url, settings.ocr_url]:
                response = await client.get(url + "/health/ready")
                response.raise_for_status()
    except httpx.HTTPError:
        raise HTTPException(503, "A required model worker is unavailable")
    return {"status": "ready"}


@app.get("/v1/schema")
def schema():
    return ProcessingResponse.model_json_schema(by_alias=True)


def decode(data):
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as source:
                if source.format not in {"PNG", "JPEG", "TIFF", "BMP", "WEBP"}:
                    raise HTTPException(415, "Unsupported image format")
                if source.width * source.height > MAX_PIXELS:
                    raise HTTPException(413, "Image exceeds 40 million pixels")
                if getattr(source, "n_frames", 1) != 1:
                    raise HTTPException(422, "Supply a single rendered page")
                source.verify()
            with Image.open(io.BytesIO(data)) as source:
                image = source.convert("RGB")
            encoded = io.BytesIO()
            image.save(encoded, format="PNG")
            return image, encoded.getvalue()
    except (Image.DecompressionBombWarning, Image.DecompressionBombError):
        raise HTTPException(413, "Image dimensions too large")
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError):
        raise HTTPException(422, "Invalid image")


async def acquire_upload(request, image):
    data = await image.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "Upload exceeds 25 MiB")
    return data


@app.post("/v1/process")
async def processing(
    request: Request,
    image: UploadFile,
    response_format: Literal["json", "zip"] = "json",
):
    capacity = request.app.state.capacity
    try:
        if capacity.locked():
            raise HTTPException(
                503, "Processing busy; retry later", headers={"Retry-After": "1"}
            )
        async with capacity:
            data = await acquire_upload(request, image)
            raster, encoded = await run_in_threadpool(decode, data)
            try:
                result, degraded = await run_in_threadpool(
                    process, raster, encoded, request.app.state.settings
                )
            except WorkerFailure:
                raise HTTPException(
                    502, "Geometry worker unavailable or returned invalid data"
                )
            except (ValueError, KeyError, TypeError):
                raise HTTPException(502, "Processing output failed validation")
            headers = {"X-Processing-Degraded": ",".join(degraded)} if degraded else {}
            if response_format == "json":
                return JSONResponse(result, headers=headers)
            buffer = io.BytesIO()
            with ZipFile(buffer, "w", ZIP_DEFLATED) as archive:
                archive.writestr("predictions.json", json.dumps(result))
            return Response(
                buffer.getvalue(),
                media_type="application/zip",
                headers={
                    **headers,
                    "Content-Disposition": 'attachment; filename="prediction.zip"',
                },
            )
    finally:
        await image.close()


@app.post("/v1/predictions")
async def legacy(
    request: Request,
    image: UploadFile,
    model: Literal[
        "cubicasa",
        "cubicasa-detail",
        "paddleocr",
    ] = "cubicasa",
    response_format: Literal["json", "zip"] = "json",
):
    try:
        data = await acquire_upload(request, image)
        await run_in_threadpool(decode, data)
        async with httpx.AsyncClient(timeout=180, follow_redirects=False) as client:
            upstream = await client.post(
                request.app.state.settings.legacy_url + "/v1/predictions",
                params={"model": model, "response_format": response_format},
                headers={"x-api-key": request.app.state.settings.api_key},
                files={"image": ("drawing.png", data, "application/octet-stream")},
            )
        if upstream.status_code != 200:
            raise HTTPException(
                (
                    upstream.status_code
                    if upstream.status_code in {413, 415, 422, 503}
                    else 502
                ),
                "Legacy inference request failed",
            )
        return Response(
            upstream.content,
            media_type=upstream.headers.get("content-type", "application/json"),
            headers=(
                {"Content-Disposition": 'attachment; filename="prediction.zip"'}
                if response_format == "zip"
                else {}
            ),
        )
    except httpx.HTTPError:
        raise HTTPException(502, "Legacy inference unavailable")
    finally:
        await image.close()


application = Boundary(app)
