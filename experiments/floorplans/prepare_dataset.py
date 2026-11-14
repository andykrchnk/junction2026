"""Create a fixed, hashed sample. Run inside the preparation image from repo root."""

import argparse
import hashlib
import json
from pathlib import Path

import fitz
from PIL import Image

ROOT = Path("datasets/stoa-dataset")
OUT = Path(".local/gpu-comparison")
RASTER = {".png", ".jpg", ".jpeg"}


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--render", action="store_true")
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    manifest_path = OUT / "manifest.json"
    if not manifest_path.exists():
        selected = []
        for source in sorted((ROOT / "data").iterdir()):
            # IFC-only sources are recorded separately; do not manufacture scan density.
            candidates = sorted(
                p for p in source.rglob("*") if p.suffix.lower() in RASTER | {".pdf"}
            )
            by_stem = {}
            for path in candidates:
                by_stem.setdefault(str(path.with_suffix("")), []).append(path)
            groups = sorted(
                by_stem.values(),
                key=lambda group: hashlib.sha256(
                    str(group[0].with_suffix("")).encode()
                ).hexdigest(),
            )
            # Four samples from PDF/CAD sources and three from other sources = 26.
            count = 4 if source.name in {"opening_design", "swiss_dwellings"} else 3
            for group in groups[:count]:
                path = min(group, key=lambda p: (p.suffix.lower() != ".pdf", str(p)))
                siblings = sorted(
                    p for p in path.parent.glob(path.stem + ".*") if p.is_file()
                )
                selected.append(
                    {
                        "id": f"{len(selected):02d}-{source.name}",
                        "source": source.name,
                        "path": str(path),
                        "sha256": digest(path),
                        "vector_inputs": [
                            {"path": str(p), "sha256": digest(p)}
                            for p in siblings
                            if p.suffix.lower() in {".svg", ".dxf", ".dwg", ".ifc"}
                        ],
                        "license": str(source / "LICENSE.md"),
                        "page": 0 if path.suffix.lower() == ".pdf" else None,
                    }
                )
        inventory = {}
        for source in sorted((ROOT / "data").iterdir()):
            inventory[source.name] = {}
            for path in source.rglob("*"):
                if path.is_file():
                    inventory[source.name][path.suffix.lower()] = (
                        inventory[source.name].get(path.suffix.lower(), 0) + 1
                    )
        manifest = {
            "selection": "SHA256 ordering of source-relative drawing groups; PDF preferred; page 0; no duplicate format siblings",
            "pdf_render": {
                "dpi": 150,
                "colorspace": "RGB",
                "alpha": False,
                "renderer": "PyMuPDF 1.25.5",
            },
            "inventory": inventory,
            "samples": selected,
        }
        manifest_path.write_text(json.dumps(manifest, indent=2))
    manifest = json.loads(manifest_path.read_text())
    if args.render:
        (OUT / "images").mkdir(exist_ok=True)
        for item in manifest["samples"]:
            path = Path(item["path"])
            if digest(path) != item["sha256"]:
                raise ValueError(f"Changed input: {path}")
            target = OUT / "images" / (item["id"] + ".png")
            if path.suffix.lower() == ".pdf":
                with fitz.open(path) as doc:
                    item["page_count"] = len(doc)
                    pix = doc[0].get_pixmap(dpi=150, colorspace=fitz.csRGB, alpha=False)
                    pix.save(target)
            else:
                with Image.open(path) as image:
                    image.convert("RGB").save(target)
            with Image.open(target) as image:
                item["width"], item["height"] = image.size
            item["raster_path"] = str(target)
            item["raster_sha256"] = digest(target)
        manifest_path.write_text(json.dumps(manifest, indent=2))
    by_path = {
        item["path"].split("stoa-dataset/", 1)[1]: item["id"]
        for item in manifest["samples"]
    }
    paired = []
    with (ROOT / "questions.jsonl").open() as questions:
        for line in questions:
            question = json.loads(line)
            if question["path"] in by_path:
                paired.append({"id": by_path[question["path"]], **question})
    (OUT / "paired-questions.json").write_text(
        json.dumps(paired, indent=2, ensure_ascii=False)
    )
    print(f"{len(manifest['samples'])} fixed drawings -> {manifest_path}")


if __name__ == "__main__":
    main()
