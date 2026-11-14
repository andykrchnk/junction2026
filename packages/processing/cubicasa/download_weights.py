"""
Download CubiCasa5K pretrained weights.

The checkpoint is hosted on Google Drive (official CubiCasa5k release).
Run:
    python download_weights.py

Requires: pip install gdown
"""

import sys
from pathlib import Path

GDRIVE_FILE_ID = "1gRB7ez1e4H7a9Y09lLqRuna0luZO5VRK"
WEIGHTS_DIR  = Path("weights")
WEIGHTS_FILE = WEIGHTS_DIR / "cubicasa5k.pkl"


if __name__ == "__main__":
    if WEIGHTS_FILE.exists():
        print(f"Weights already present at {WEIGHTS_FILE}. Delete to re-download.")
        sys.exit(0)

    try:
        import gdown
    except ImportError:
        print("gdown is required: pip install gdown")
        sys.exit(1)

    WEIGHTS_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Downloading CubiCasa5k weights from Google Drive → {WEIGHTS_FILE}")
    gdown.download(id=GDRIVE_FILE_ID, output=str(WEIGHTS_FILE), quiet=False)

    if WEIGHTS_FILE.exists():
        print(f"\nWeights saved to: {WEIGHTS_FILE}")
        print("You can now run inference:")
        print(f"  python inference.py --checkpoint {WEIGHTS_FILE} --image floor_plan.png")
    else:
        print("\nDownload failed. Download manually from:")
        print("  https://drive.google.com/file/d/1gRB7ez1e4H7a9Y09lLqRuna0luZO5VRK/view")
        print(f"and place it at: {WEIGHTS_FILE}")
        sys.exit(1)
