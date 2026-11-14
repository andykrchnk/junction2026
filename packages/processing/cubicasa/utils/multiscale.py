"""Native-source tiles, bounded by a connected-linework building proposal."""

import numpy as np
import torch
from PIL import Image
from scipy import ndimage
from torch.nn import functional as F

from .preprocessor import ImageTransform, preprocess_image


def building_bounds(source):
    """Propose the dominant connected drawing area, or retain the full sheet.

    A one-pixel bridge joins antialiased structural linework without joining
    nearby text paragraphs. This is only a crop heuristic, not room evidence or
    a document-type classifier. Multiple substantial components trigger fallback.
    """
    ink = np.asarray(source.convert("L")) < 150
    labels, count = ndimage.label(ndimage.binary_dilation(ink, iterations=1))
    support = np.bincount(labels.ravel(), minlength=count + 1)
    support[0] = 0
    ranked = np.argsort(support)[::-1]
    full = (0, 0, source.width, source.height)
    if not count or support[ranked[0]] < ink.size * 0.005:
        return full, "insufficient_connected_linework"
    if len(ranked) > 1 and support[ranked[1]] > support[ranked[0]] * 0.2:
        return full, "multiple_substantial_components"
    y, x = ndimage.find_objects(labels)[ranked[0] - 1]
    if (x.stop - x.start) < source.width * 0.2 or (y.stop - y.start) < source.height * 0.2:
        return full, "small_connected_component"
    margin = 48
    return (
        max(0, x.start - margin), max(0, y.start - margin),
        min(source.width, x.stop + margin), min(source.height, y.stop + margin),
    ), "dominant_connected_linework"


def predict_detail(model, tensor, source, transform):
    baseline = model(tensor).float().cpu()
    if max(transform.original_width, transform.original_height) <= 2048:
        return baseline, {
            "tiles": 0, "crop_reason": "source_already_upsampled",
            "tile_source": "whole_image",
        }, None, transform
    if isinstance(source, (str, bytes)) or hasattr(source, "__fspath__"):
        source = Image.open(source).convert("RGB")
    elif isinstance(source, np.ndarray):
        source = Image.fromarray(source.astype(np.uint8)).convert("RGB")
    else:
        source = source.convert("RGB")
    bounds, reason = building_bounds(source)
    # Keep the established 2048-pixel reconstruction budget. Tiles always
    # come from the original RGB image, never the resized overview tensor.
    scale = min(1.0, 2048 / max(source.size))
    width, height = max(1, round(source.width * scale)), max(1, round(source.height * scale))
    output_transform = ImageTransform(source.height, source.width, height, width,
                                      height, width, 0, 0)
    rows, columns = transform.content_slices
    coarse = F.interpolate(baseline[:, :, rows, columns], size=(height, width),
                           mode="bilinear", align_corners=False)
    del baseline
    left, top, right, bottom = bounds
    gx0, gy0 = round(left * scale), round(top * scale)
    gx1, gy1 = round(right * scale), round(bottom * scale)
    # Outside the proposed crop is explicitly background, including heatmaps.
    background = torch.zeros_like(coarse)
    background[:, 21] = 20
    background[:, 33] = 20
    background[:, :, gy0:gy1, gx0:gx1] = coarse[:, :, gy0:gy1, gx0:gx1]
    coarse = background
    total = torch.zeros_like(coarse)
    weights = torch.zeros_like(coarse[:, :1])
    size, stride = 1024, 768

    def starts(lo, hi):
        return sorted(set([*range(lo, max(lo + 1, hi - size + 1), stride), max(lo, hi - size)]))

    count = 0
    for y in starts(top, bottom):
        for x in starts(left, right):
            x1, y1 = min(x + size, right), min(y + size, bottom)
            tile, tile_transform = preprocess_image(
                source.crop((x, y, x1, y1)), fixed_size=(2048, 2048), device=tensor.device
            )
            prediction = model(tile).float().cpu()
            tr, tc = tile_transform.content_slices
            ax, ay, bx, by = round(x * scale), round(y * scale), round(x1 * scale), round(y1 * scale)
            prediction = F.interpolate(prediction[:, :, tr, tc], size=(by - ay, bx - ax),
                                       mode="bilinear", align_corners=False)
            wy = torch.hann_window(by - ay, periodic=False).clamp_min(0.05)
            wx = torch.hann_window(bx - ax, periodic=False).clamp_min(0.05)
            window = (wy[:, None] * wx[None, :])[None, None]
            total[:, :, ay:by, ax:bx] += prediction * window
            weights[:, :, ay:by, ax:bx] += window
            del tile, prediction
            count += 1
    refined = torch.where(weights > 0, total / weights.clamp_min(1e-6), coarse)
    return refined, {
        "tiles": count, "tile_size_source_pixels": size, "stride_source_pixels": stride,
        "building_crop_source_pixels": list(bounds), "crop_reason": reason,
        "output_grid_scale": scale, "tile_source": "original_image",
    }, coarse, output_transform
