"""Contract and safety regressions, runnable without GPUs or paid requests."""

import unittest
from types import SimpleNamespace
from PIL import Image
from pydantic import ValidationError
from shapely.geometry import Polygon as ShapePolygon
from schemas import ProcessingResponse
from taxonomy import ROOM_CLASSES, ICON_CLASSES
from clients.gemini import validate
from stages.normalize import normalize
from stages.resolve import apply
from stages.annotations import extract, resolve


class Contract(unittest.TestCase):
    def target(self):
        return {
            "kind": "room",
            "class": "Living Room",
            "confidence": 0.4,
            "name": None,
            "geometry": ShapePolygon(
                [(0, 0), (20, 0), (20, 20), (0, 20)],
                holes=[[(5, 5), (5, 8), (8, 8), (8, 5)]],
            ),
            "measurements": {},
        }

    def test_fixed_taxonomy_and_holes_survive(self):
        result = normalize(Image.new("RGB", (100, 100)), [self.target()]).model_dump(
            mode="json", by_alias=True
        )
        self.assertEqual((len(ROOM_CLASSES), len(ICON_CLASSES)), (12, 11))
        self.assertEqual(len(result["rooms"][0]["geometry"]["coordinates"]), 2)
        self.assertEqual(
            set(result), {"coordinate_system", "image", "rooms", "fixtures"}
        )
        self.assertIsNone(result["rooms"][0]["measurements"]["area"])
        result["rooms"][0]["class"] = "Invented Room"
        with self.assertRaises(ValidationError):
            ProcessingResponse.model_validate(result)

    def test_invalid_geometry_and_dangling_relationship_rejected(self):
        t = self.target()
        t["geometry"] = ShapePolygon([(0, 0), (20, 20), (0, 20), (20, 0)])
        with self.assertRaises(ValidationError):
            normalize(Image.new("RGB", (100, 100)), [t])
        t = self.target()
        t["kind"] = "fixture"
        t["class"] = "Door"
        obj = normalize(Image.new("RGB", (100, 100)), [t]).model_dump(
            mode="json", by_alias=True
        )
        obj["fixtures"][0]["room_ids"] = ["nonexistent"]
        with self.assertRaises(ValidationError):
            ProcessingResponse.model_validate(obj)

    def test_foreign_gemini_label_rejected(self):
        q = {"class": {"type": "choice", "criteria": {c: c for c in ICON_CLASSES}}}
        a = {
            "answers": {
                "class": {
                    "type": "choice",
                    "choice": "Bench",
                    "confidence": 1,
                    "probabilities": {"Bench": 1},
                }
            }
        }
        with self.assertRaises(ValueError):
            validate(a, q)

    def test_weak_override_retains_original_score(self):
        t = self.target()
        a = {
            "class": {"choice": "Hallway", "confidence": 0.99},
            "evidence": {"noul": 0.2},
            "single_space": {"noul": 0.99},
        }
        apply(t, a)
        self.assertEqual((t["class"], t["confidence"]), ("Living Room", 0.4))

    def test_swing_blocks_window_override(self):
        t = self.target()
        t.update(kind="fixture")
        t["class"] = "Door"
        a = {
            "class": {"choice": "Window", "confidence": 0.99},
            "evidence": {"noul": 0.99},
            "exists": {"noul": 0.99},
            "door_swing": {"noul": 0.9},
            "window": {"noul": 0.99},
        }
        apply(t, a)
        self.assertEqual(t["class"], "Door")

    def test_only_explicit_compatible_units(self):
        self.assertEqual(extract("900 x 2100"), [])
        self.assertEqual(extract("1 200 mm"), [])
        self.assertEqual(extract("12,6 m²")[0]["value"], 12.6)
        a = {
            "property": {"choice": "area", "confidence": 0.99},
            "transcription_correct": {"noul": 0.99},
            "belongs_to_target": {"noul": 0.99},
        }
        self.assertIsNone(resolve(extract("12.6 m")[0], a)["property"])

    def test_optional_stage_failure_returns_baseline_and_null_measurements(self):
        from pathlib import Path
        from tempfile import TemporaryDirectory
        from unittest.mock import patch
        from schemas import WorkerResponse
        from clients.workers import WorkerFailure
        from clients.gemini import VerificationFailure
        from pipeline import process

        worker = WorkerResponse.model_validate(
            {
                "image": {"width": 100, "height": 100},
                "model": {"name": "cubicasa-detail"},
                "room_instances": [
                    {
                        "model_label": "Bedroom",
                        "geometry_wkt": "POLYGON ((0 0,20 0,20 20,0 20,0 0))",
                        "bbox": [0, 0, 20, 20],
                        "confidence": 0.7,
                    }
                ],
            }
        )
        with TemporaryDirectory() as tmp:
            settings = SimpleNamespace(
                artifact_dir=Path(tmp),
                geometry_url="geometry",
                ocr_url="ocr",
                api_key="unused",
                model="gemini-decision-1",
                max_targets=500,
                deadline_seconds=180,
                gemini_workers=1,
            )

            def response(url, *args):
                if url == "ocr":
                    raise WorkerFailure("offline")
                return worker

            with patch("pipeline.predict", side_effect=response), patch(
                "pipeline.Gemini"
            ) as verifier:
                verifier.return_value.decide.side_effect = VerificationFailure(
                    "offline"
                )
                result, degraded = process(Image.new("RGB", (100, 100)), b"", settings)
            self.assertEqual(degraded, ["gemini", "ocr"])
            self.assertEqual(result["rooms"][0]["class"], "Bedroom")
            self.assertEqual(result["rooms"][0]["confidence"], 0.7)
            self.assertTrue(
                all(v is None for v in result["rooms"][0]["measurements"].values())
            )
            self.assertIsNone(result["rooms"][0]["name"])


if __name__ == "__main__":
    unittest.main()
