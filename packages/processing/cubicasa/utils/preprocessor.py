"""Image preprocessing for CubiCasa5K inference."""

from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Tuple, Union

import numpy as np
import torch
from PIL import Image


@dataclass(frozen=True)
class ImageTransform:
    """Geometry needed to map model-space predictions to source pixels."""

    original_height: int
    original_width: int
    model_height: int
    model_width: int
    content_height: int
    content_width: int
    padding_top: int
    padding_left: int

    @property
    def content_slices(self) -> Tuple[slice, slice]:
        return (
            slice(self.padding_top, self.padding_top + self.content_height),
            slice(self.padding_left, self.padding_left + self.content_width),
        )

    def to_dict(self) -> dict:
        return asdict(self)


def _pad_to_multiple(height: int, width: int, multiple: int = 32) -> Tuple[int, int]:
    """Return dimensions padded up to the nearest model-compatible multiple."""
    pad_height = (multiple - height % multiple) % multiple
    pad_width = (multiple - width % multiple) % multiple
    return height + pad_height, width + pad_width


def preprocess_image(
    image: Union[str, Path, np.ndarray, Image.Image],
    fixed_size: Tuple[int, int] | None = None,
    device: str = "cpu",
) -> Tuple[torch.Tensor, ImageTransform]:
    """Load an image using CubiCasa's training normalization.

    Fixed-size input is letterboxed instead of stretched, so measurements and
    angles remain meaningful. The original CubiCasa loader maps RGB values to
    ``[-1, 1]``; using ImageNet normalization here materially changes inputs.
    """
    if isinstance(image, (str, Path)):
        source = Image.open(image).convert("RGB")
    elif isinstance(image, np.ndarray):
        source = Image.fromarray(image.astype(np.uint8)).convert("RGB")
    elif isinstance(image, Image.Image):
        source = image.convert("RGB")
    else:
        raise TypeError(f"Unsupported image type: {type(image)}")

    original_height, original_width = source.height, source.width

    if fixed_size is None:
        model_height, model_width = _pad_to_multiple(
            original_height,
            original_width,
        )
        content_height, content_width = original_height, original_width
        padding_top = 0
        padding_left = 0
        prepared = Image.new("RGB", (model_width, model_height), (255, 255, 255))
        prepared.paste(source, (padding_left, padding_top))
    else:
        model_height, model_width = fixed_size
        scale = min(model_width / original_width, model_height / original_height)
        content_width = max(1, round(original_width * scale))
        content_height = max(1, round(original_height * scale))
        padding_left = (model_width - content_width) // 2
        padding_top = (model_height - content_height) // 2

        resized = source.resize((content_width, content_height), Image.BILINEAR)
        prepared = Image.new("RGB", (model_width, model_height), (255, 255, 255))
        prepared.paste(resized, (padding_left, padding_top))

    transform = ImageTransform(
        original_height=original_height,
        original_width=original_width,
        model_height=model_height,
        model_width=model_width,
        content_height=content_height,
        content_width=content_width,
        padding_top=padding_top,
        padding_left=padding_left,
    )

    pixels = np.asarray(prepared, dtype=np.float32)
    pixels = 2.0 * (pixels / 255.0) - 1.0
    tensor = torch.from_numpy(pixels).permute(2, 0, 1).unsqueeze(0).to(device)
    return tensor, transform
