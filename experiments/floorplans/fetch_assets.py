"""Fetch verified official inference assets into ignored local storage; no training."""

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import tarfile
import urllib.request
import zipfile

ROOT = Path(".local/gpu-comparison")
DATASET = Path("datasets/stoa-dataset")
LOCK = json.loads(Path(__file__).with_name("sources.lock.json").read_text())


def digest(path):
    with path.open("rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()


def fetch(url, path, checksum=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        part = path.with_name(path.name + ".part")
        urllib.request.urlretrieve(url, part)
        if checksum and digest(part) != checksum:
            raise ValueError("Checksum mismatch: " + str(path))
        part.rename(path)
    if checksum and digest(path) != checksum:
        raise ValueError("Checksum mismatch: " + str(path))


def unpack_tar(archive, directory):
    with tarfile.open(archive) as tar:
        for member in tar.getmembers():
            if not (member.isfile() or member.isdir()):
                continue
            member.name = "/".join(PurePosixPath(member.name).parts[1:])
            if member.name:
                tar.extract(member, directory, filter="data")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", action="store_true")
    args = parser.parse_args()
    ROOT.mkdir(parents=True, exist_ok=True)
    if args.dataset:
        # Reuse existing drawings first, and never overwrite tracked documentation/questions.
        if not (DATASET / "data").exists():
            archive = ROOT / "dataset.zip"
            fetch(LOCK["dataset"]["url"], archive, LOCK["dataset"]["sha256"])
            with zipfile.ZipFile(archive) as z:
                for member in z.infolist():
                    p = PurePosixPath(member.filename)
                    if p.is_absolute() or ".." in p.parts:
                        raise ValueError("Unsafe ZIP member")
                    if not p.parts or p.parts[0] != "junction-dataset":
                        raise ValueError("Unexpected ZIP root")
                    relative = Path(*p.parts[1:])
                    target = DATASET / relative
                    if member.is_dir():
                        target.mkdir(parents=True, exist_ok=True)
                    elif not target.exists():
                        target.parent.mkdir(parents=True, exist_ok=True)
                        with z.open(member) as source, target.open("wb") as dest:
                            shutil.copyfileobj(source, dest)
                (ROOT / "dataset-archive-README.md").write_bytes(
                    z.read("junction-dataset/README.md")
                )
        payload = next((DATASET / "data").rglob("*.png"))
        subprocess.run(["git", "check-ignore", "--quiet", str(payload)], check=True)
    for name, source in LOCK["sources"].items():
        archive = ROOT / "upstream" / (name + ".tar.gz")
        fetch(
            f"https://codeload.github.com/{source['repo']}/tar.gz/{source['sha']}",
            archive,
        )
        unpack_tar(archive, ROOT / "upstream" / (name + "-src"))
    for name, asset in LOCK["assets"].items():
        fetch(asset["url"], ROOT / name, asset["sha256"])
    for name in ["det", "rec", "cls"]:
        with tarfile.open(ROOT / "ocr" / (name + ".tar")) as tar:
            for member in tar.getmembers():
                if member.isfile():
                    member.name = PurePosixPath(member.name).name
                    tar.extract(member, ROOT / "ocr" / name, filter="data")
    weights = Path("packages/processing/cubicasa/weights")
    weights.mkdir(exist_ok=True)
    dest = weights / "cubicasa5k.pkl"
    if not dest.exists():
        shutil.copyfile(ROOT / "cubicasa5k.pkl", dest)
    if digest(dest) != LOCK["assets"]["cubicasa5k.pkl"]["sha256"]:
        raise ValueError("Existing CubiCasa checkpoint differs")
    print(
        "Official sources and checkpoint checksums verified. Private assets remain in ignored paths."
    )


if __name__ == "__main__":
    main()
