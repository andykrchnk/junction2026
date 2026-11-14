"""
Visualization helpers for CubiCasa5K predictions.
"""

from pathlib import Path
from typing import Optional

import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np
from matplotlib.colors import ListedColormap

from model.segmentation_net import ROOM_CLASSES, ICON_CLASSES
from utils.postprocessor import SegmentationResult

# ---------------------------------------------------------------------------
# Color palettes
# ---------------------------------------------------------------------------

# One color per room class (Background … Undefined)
ROOM_COLORS = np.array([
    [255, 255, 255],   # 0  Background  – white
    [187, 213, 230],   # 1  Outdoor     – light blue
    [ 60,  60,  60],   # 2  Wall        – dark grey
    [255, 204, 102],   # 3  Kitchen     – amber
    [144, 238, 144],   # 4  Living Room – light green
    [173, 216, 230],   # 5  Bedroom     – sky blue
    [255, 182, 193],   # 6  Bath        – pink
    [255, 255, 153],   # 7  Hallway     – yellow
    [200, 200, 200],   # 8  Railing     – light grey
    [255, 178, 102],   # 9  Storage     – peach
    [169, 169, 169],   # 10 Garage      – grey
    [230, 230, 250],   # 11 Undefined   – lavender
], dtype=np.uint8)

# One color per icon class
ICON_COLORS = np.array([
    [255, 255, 255],  # 0  No Icon
    [  0, 120, 215],  # 1  Window
    [  0, 200,  83],  # 2  Door
    [100, 100, 200],  # 3  Closet
    [255, 165,   0],  # 4  Electrical Appliance
    [220,  20,  60],  # 5  Toilet
    [ 64, 224, 208],  # 6  Sink
    [139,  69,  19],  # 7  Sauna Bench
    [255,  69,   0],  # 8  Fire Place
    [135, 206, 250],  # 9  Bathtub
    [ 70,  70,  70],  # 10 Chimney
    [200, 200, 200],  # 11-16 unused
    [200, 200, 200],
    [200, 200, 200],
    [200, 200, 200],
    [200, 200, 200],
    [200, 200, 200],
], dtype=np.uint8)


def _label_to_rgb(label_map: np.ndarray, palette: np.ndarray) -> np.ndarray:
    h, w = label_map.shape
    rgb = palette[label_map.clip(0, len(palette) - 1)]
    return rgb.reshape(h, w, 3)


# ---------------------------------------------------------------------------
# Main visualisation function
# ---------------------------------------------------------------------------

def visualize_predictions(
    original_image: np.ndarray,
    result: SegmentationResult,
    save_path: Optional[str] = None,
    show: bool = True,
    alpha: float = 0.55,
) -> np.ndarray:
    """
    Produce a 2×2 figure:
      [original | room segmentation overlay]
      [wall mask | icon segmentation overlay]

    Parameters
    ----------
    original_image : H×W×3 uint8
    result         : SegmentationResult from PostProcessor
    save_path      : if given, save figure to this path
    show           : call plt.show()
    alpha          : blend weight for overlay

    Returns
    -------
    composite RGB numpy array (H×W×3 uint8)
    """
    orig = original_image.astype(np.uint8)
    h, w = orig.shape[:2]

    room_rgb = _label_to_rgb(result.room_mask, ROOM_COLORS)
    icon_rgb = _label_to_rgb(result.icon_mask, ICON_COLORS)

    room_overlay = _blend(orig, room_rgb, alpha)
    icon_overlay = _blend(orig, icon_rgb, alpha)

    wall_vis = (result.wall_mask * 255).astype(np.uint8)

    fig, axes = plt.subplots(2, 2, figsize=(14, 10))
    ax = axes.flatten()

    ax[0].imshow(orig)
    ax[0].set_title("Original floor plan", fontsize=11)

    ax[1].imshow(room_overlay)
    ax[1].set_title("Room segmentation", fontsize=11)
    _add_legend(ax[1], ROOM_CLASSES, ROOM_COLORS, result.room_mask)

    ax[2].imshow(wall_vis, cmap="gray")
    ax[2].set_title("Wall mask", fontsize=11)

    ax[3].imshow(icon_overlay)
    ax[3].set_title("Icon detection", fontsize=11)
    _add_legend(ax[3], ICON_CLASSES, ICON_COLORS, result.icon_mask)

    # Draw polygon boundaries on the room overlay panel
    for cls_name, polys in result.room_polygons.items():
        for poly in polys:
            if poly.geom_type == "Polygon":
                xs, ys = poly.exterior.xy
                ax[1].plot(xs, ys, "k-", linewidth=1.0, alpha=0.8)
            elif poly.geom_type == "MultiPolygon":
                for sub in poly.geoms:
                    xs, ys = sub.exterior.xy
                    ax[1].plot(xs, ys, "k-", linewidth=1.0, alpha=0.8)

    # Mark icon centroids
    for detection in result.icon_detections:
        ax[3].plot(
            detection.centroid_x,
            detection.centroid_y,
            "r+",
            markersize=8,
            markeredgewidth=1.5,
        )
        ax[3].text(
            detection.centroid_x + 3,
            detection.centroid_y - 3,
            f"{detection.class_name} {detection.confidence:.0%}",
            fontsize=6,
            color="red",
        )

    for a in ax:
        a.axis("off")

    plt.tight_layout()

    if save_path:
        Path(save_path).parent.mkdir(parents=True, exist_ok=True)
        plt.savefig(save_path, dpi=150, bbox_inches="tight")

    if show:
        plt.show()

    # Build composite for programmatic use
    fig.canvas.draw()
    # On Retina displays, the renderer's backing buffer can be larger than
    # get_width_height() because of the device pixel ratio. Reading the shaped
    # renderer buffer avoids reconstructing it with incorrect dimensions.
    rgba = np.asarray(fig.canvas.get_renderer().buffer_rgba())
    composite = rgba[:, :, :3].copy()
    plt.close(fig)
    return composite


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _blend(img: np.ndarray, overlay: np.ndarray, alpha: float) -> np.ndarray:
    return (img * (1 - alpha) + overlay * alpha).clip(0, 255).astype(np.uint8)


def _add_legend(ax, class_names, colors, mask):
    """Add a compact legend showing only the classes present in mask."""
    present = np.unique(mask)
    patches = []
    for idx in present:
        if idx >= len(class_names):
            continue
        c = colors[idx] / 255.0
        patches.append(
            mpatches.Patch(color=c, label=class_names[idx])
        )
    if patches:
        ax.legend(
            handles=patches,
            loc="lower right",
            fontsize=6,
            framealpha=0.7,
            ncol=2,
        )
