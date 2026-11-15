import json
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from clients.workers import predict, WorkerFailure
from clients.gemini import Gemini, VerificationFailure
from stages.prepare import targets, context, image_part, room_fixture_context
from stages.verify import verify
from stages.resolve import apply
from stages.normalize import normalize


def process(image, image_bytes, settings):
    started_at = time.monotonic()
    directory = settings.artifact_dir / uuid.uuid4().hex
    directory.mkdir(parents=True, mode=0o700)
    timings = {}

    @contextmanager
    def timed(stage):
        stage_started_at = time.monotonic()
        try:
            yield
        finally:
            timings[stage] = round(time.monotonic() - stage_started_at, 3)
            (directory / "timings.json").write_text(
                json.dumps({
                    "seconds": timings,
                    "elapsed_seconds": round(time.monotonic() - started_at, 3),
                })
            )

    degraded = set()
    with timed("geometry"):
        geometry = predict(
            settings.geometry_url, settings.api_key, image_bytes, "cubicasa-detail"
        )
        if (geometry.image.width, geometry.image.height) != image.size:
            raise WorkerFailure("Geometry coordinate system mismatch")
    try:
        with timed("ocr"):
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
    fixtures = [target for target in proposals if target["kind"] == "fixture"]
    rooms = [target for target in proposals if target["kind"] == "room"]
    overview = image.copy()
    overview.thumbnail((1200, 1200))
    overview_part = image_part(overview)
    verifier = Gemini(settings, directory / "gemini")
    deadline = time.monotonic() + settings.deadline_seconds

    def evaluate(pair):
        index, target = pair
        if index >= settings.max_targets or time.monotonic() >= deadline:
            if target["kind"] == "fixture":
                target["verification"] = {
                    "resolution": "not_verified", "reason": "verification_limit"
                }
            return "verification_limit"
        parts, words, bounds = context(target, image, tokens, overview_part)
        try:
            candidate = dict(target)
            answers = verify(candidate, parts, words, bounds, verifier)
            apply(candidate, answers)
        except VerificationFailure:
            if target["kind"] == "fixture":
                target["verification"] = {
                    "resolution": "not_verified", "reason": "gemini"
                }
            return "gemini"
        # A classification recheck must not discard independently verified units.
        target["measurements"] = candidate["measurements"]
        if (
            target["kind"] == "fixture"
            and not target.get("requires_verification", False)
            and {target["class"], answers["class"]["choice"]} & {
                "Bathtub", "Sauna Bench", "Shower Cabin", "Closet"
            }
            and (
                target["class"] != answers["class"]["choice"]
                or candidate["verification"]["resolution"] != "resolved"
            )
        ):
            initial_candidate = candidate
            initial = dict(candidate["verification"])
            if time.monotonic() >= deadline:
                target["verification"] = {
                    **initial, "resolution": "ambiguous", "recheck": "verification_limit"
                }
                return "verification_limit"
            parts, words, bounds = context(
                target, image, tokens, overview_part, closeup=True
            )
            candidate = dict(target)
            try:
                answers = verify(candidate, parts, words, bounds, verifier)
                apply(candidate, answers)
            except VerificationFailure:
                target["verification"] = {
                    **initial, "resolution": "ambiguous", "recheck": "gemini"
                }
                return "gemini"
            closeup = dict(candidate["verification"])
            if (
                initial["resolution"] == "resolved"
                and candidate["verification"]["resolution"] == "resolved"
                and initial["selected_class"] != candidate["verification"]["selected_class"]
            ):
                # Confident but contradictory views are not a verified correction.
                target["verification"] = {
                    **closeup, "resolution": "conflicting_views",
                    "recheck": "completed", "initial_view": initial,
                }
                return None
            if (
                initial["resolution"] == "resolved"
                and closeup["resolution"] != "resolved"
                and initial["selected_class"] == closeup["selected_class"]
                and closeup["selected_class"] in {"Bathtub", "Sauna Bench", "Shower Cabin"}
                and closeup["selected_class_score"] > 0.5
                and closeup["existence_score"] > 0.5
                and closeup["class_basis"] in {
                    "fixture_symbol", "associated_label", "symbol_and_label"
                }
            ):
                # A less certain close-up that supports the same directly evidenced
                # class does not invalidate the strong contextual classification.
                candidate = initial_candidate
                candidate["verification"] = {
                    **initial, "recheck": "corroborated", "closeup_view": closeup,
                }
            else:
                candidate["verification"].update(
                    recheck="completed", initial_view=initial
                )
        candidate["measurements"] = target["measurements"]
        target.update(candidate)
        return None

    try:
        with ThreadPoolExecutor(max_workers=settings.gemini_workers) as pool:
            with timed("verify_fixture"):
                degraded.update(
                    result for result in pool.map(evaluate, enumerate(fixtures)) if result
                )
            # Finish fixture decisions (including rechecks) before making a stable
            # per-room evidence snapshot. The target/deadline budget spans both passes.
            for room in rooms:
                room["fixture_context"] = room_fixture_context(room, fixtures)
            with timed("verify_room"):
                degraded.update(
                    result
                    for result in pool.map(evaluate, enumerate(rooms, start=len(fixtures)))
                    if result
                )
    finally:
        verifier.close()
    if any(
        target["kind"] == "fixture"
        and target.get("decision") != "removed"
        and target.get("verification", {}).get("resolution") != "resolved"
        for target in proposals
    ):
        degraded.add("fixture_uncertainty")
    with timed("normalize"):
        result = normalize(image, proposals)
    (directory / "predictions.json").write_text(result.model_dump_json(by_alias=True))
    (directory / "decisions.json").write_text(
        json.dumps([{k: v for k, v in t.items() if k != "geometry"} for t in proposals])
    )
    (directory / "status.json").write_text(
        json.dumps(
            {
                "degraded": sorted(degraded),
                "policy": "fixture-informed-rooms-v1",
                "verification_order": ["fixtures", "rooms"],
                "model": settings.model,
            }
        )
    )
    return result.model_dump(mode="json", by_alias=True), sorted(degraded)
