import json
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from clients.workers import predict, WorkerFailure
from clients.gemini import Gemini, VerificationFailure
from stages.prepare import targets, context, image_part
from stages.verify import verify
from stages.resolve import apply
from stages.normalize import normalize


def process(image, image_bytes, settings):
    directory = settings.artifact_dir / uuid.uuid4().hex
    directory.mkdir(parents=True, mode=0o700)
    degraded = set()
    geometry = predict(
        settings.geometry_url, settings.api_key, image_bytes, "cubicasa-detail"
    )
    if (geometry.image.width, geometry.image.height) != image.size:
        raise WorkerFailure("Geometry coordinate system mismatch")
    try:
        ocr = predict(settings.ocr_url, settings.api_key, image_bytes, "paddleocr")
        if (ocr.image.width, ocr.image.height) != image.size:
            raise WorkerFailure("OCR coordinate system mismatch")
        tokens = ocr.ocr or []
        (directory / "ocr.json").write_text(ocr.model_dump_json(by_alias=True))
    except WorkerFailure:
        degraded.add("ocr")
        tokens = []
    (directory / "geometry.json").write_text(geometry.model_dump_json(by_alias=True))
    proposals = targets(geometry, image)
    overview = image.copy()
    overview.thumbnail((1200, 1200))
    overview_part = image_part(overview)
    verifier = Gemini(settings, directory / "gemini")
    deadline = time.monotonic() + settings.deadline_seconds

    def evaluate(pair):
        index, target = pair
        if index >= settings.max_targets or time.monotonic() >= deadline:
            return "verification_limit"
        parts, words, bounds = context(target, image, tokens, overview_part)
        try:
            answers = verify(target, parts, words, bounds, verifier)
            apply(target, answers)
        except VerificationFailure:
            return "gemini"
        return None

    try:
        with ThreadPoolExecutor(max_workers=settings.gemini_workers) as pool:
            degraded.update(
                result for result in pool.map(evaluate, enumerate(proposals)) if result
            )
    finally:
        verifier.close()
    result = normalize(image, proposals)
    (directory / "predictions.json").write_text(result.model_dump_json(by_alias=True))
    (directory / "decisions.json").write_text(
        json.dumps([{k: v for k, v in t.items() if k != "geometry"} for t in proposals])
    )
    (directory / "status.json").write_text(
        json.dumps(
            {
                "degraded": sorted(degraded),
                "policy": "conservative-v1",
                "model": settings.model,
            }
        )
    )
    return result.model_dump(mode="json", by_alias=True), sorted(degraded)
