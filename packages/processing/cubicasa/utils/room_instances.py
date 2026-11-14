"""Class-independent region extraction with explicit, uncalibrated review checks."""

from dataclasses import dataclass

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from shapely import affinity
from shapely.geometry import Polygon, box
from shapely.ops import unary_union
from skimage import measure


@dataclass(frozen=True)
class InstanceSettings:
    wall_threshold: float = 0.5
    outdoor_threshold: float = 0.5
    stability_thresholds: tuple[float, float] = (0.35, 0.65)
    minimum_stability_iou: float = 0.8
    minimum_area_fraction: float = 0.0001
    minimum_structure_support: float = 0.3
    closing_radius: int = 1


def polygon_parts(shape):
    if shape.geom_type == "Polygon":
        return [shape] if not shape.is_empty else []
    return [
        part for child in getattr(shape, "geoms", []) for part in polygon_parts(child)
    ]


def rasterize(shapes, width, height, scale_x, scale_y):
    canvas = Image.new("1", (width, height))
    draw = ImageDraw.Draw(canvas)
    for shape in shapes:
        draw.polygon(
            [(x / scale_x, y / scale_y) for x, y in shape.exterior.coords], fill=1
        )
        for ring in shape.interiors:
            draw.polygon([(x / scale_x, y / scale_y) for x, y in ring.coords], fill=0)
    return np.asarray(canvas).copy()


def region_scores(shape, grid, scale_x, scale_y):
    projected = affinity.scale(shape, 1 / scale_x, 1 / scale_y, origin=(0, 0))
    x0, y0, x1, y1 = projected.bounds
    height, width = grid.shape[-2:]
    left, top = max(0, int(np.floor(x0))), max(0, int(np.floor(y0)))
    right, bottom = min(width, int(np.ceil(x1)) + 1), min(height, int(np.ceil(y1)) + 1)
    if left >= right or top >= bottom:
        return np.zeros(grid.shape[0], dtype=np.float32)
    shifted = affinity.translate(projected, -left, -top)
    mask = rasterize([shifted], right - left, bottom - top, 1, 1)
    values = grid[:, top:bottom, left:right][:, mask].astype(np.float32)
    return (
        values.mean(axis=1)
        if values.size
        else np.zeros(grid.shape[0], dtype=np.float32)
    )


def mask_polygons(mask, scale_x, scale_y, minimum_area):
    labels, _ = ndimage.label(mask)
    regions = []
    for label, slices in enumerate(ndimage.find_objects(labels), 1):
        if slices is None:
            continue
        component = labels[slices] == label
        if component.sum() * scale_x * scale_y < minimum_area:
            continue
        contours = measure.find_contours(np.pad(component, 1).astype(np.float32), 0.5)
        shapes = [
            Polygon(
                np.column_stack(
                    (c[:, 1] + slices[1].start - 1, c[:, 0] + slices[0].start - 1)
                )
            )
            for c in contours
            if len(c) >= 4
        ]
        if not shapes:
            continue
        outer = max(shapes, key=lambda shape: shape.area)
        holes = [
            shape.exterior.coords
            for shape in shapes
            if shape is not outer and outer.contains(shape)
        ]
        polygon = Polygon(outer.exterior.coords, holes).simplify(
            0.5, preserve_topology=True
        )
        polygon = affinity.scale(polygon, scale_x, scale_y, origin=(0, 0))
        if polygon.is_valid and polygon.area >= minimum_area:
            regions.append(polygon)
    return regions


def recover_openings(icon_probabilities, structures, scale_x, scale_y):
    """Recover dense Door proposals omitted by the junction decoder."""
    existing = [r["shape"] for r in structures
                if r["type"] == "icon" and r["class_id"] in {1, 2}]
    labels, _ = ndimage.label(icon_probabilities[2] > 0.5)
    proposals = []
    for index, slices in enumerate(ndimage.find_objects(labels), 1):
        if slices is None:
            continue
        rows, columns = slices
        if (labels[slices] == index).sum() < 8 or max(
            rows.stop - rows.start, columns.stop - columns.start
        ) < 6:
            continue
        shape = box(columns.start * scale_x, rows.start * scale_y,
                    columns.stop * scale_x, rows.stop * scale_y)
        score = float(region_scores(shape, icon_probabilities, scale_x, scale_y)[2])
        if score < 0.55 or any(
            shape.intersection(other).area / min(shape.area, other.area) > 0.25
            for other in existing if other.area > 0
        ):
            continue
        proposals.append({"shape": shape, "type": "icon", "class_id": 2,
                          "requires_verification": True, "dense_support": score})
    return sorted(proposals, key=lambda r: r["dense_support"], reverse=True)[:64]


def extract_instances(
    room_probabilities,
    icon_probabilities,
    footprint_regions,
    structures,
    transform,
    settings=InstanceSettings(),
):
    """Use model evidence only. CAD references are never accepted by this function.

    All input/output geometry uses source pixels; grids are cropped model content.
    Review checks describe consistency, never probability of correctness.
    """
    height, width = room_probabilities.shape[-2:]
    if icon_probabilities.shape[-2:] != (height, width):
        raise ValueError("Room and icon grids must have matching dimensions")
    scale_x = transform.original_width / width
    scale_y = transform.original_height / height
    minimum_area = (
        transform.original_width
        * transform.original_height
        * settings.minimum_area_fraction
    )
    footprint = unary_union(
        [p for p in footprint_regions if p.is_valid and not p.is_empty]
    )
    footprint_mask = rasterize(
        polygon_parts(footprint), width, height, scale_x, scale_y
    )
    # The official junction grid can miss thin balcony railings and classify a
    # large cell as background, dropping strong Outdoor evidence inside it.
    # Recover only model-supported outdoor pixels; never extrapolate rectangles.
    outdoor_mask = room_probabilities[1] >= settings.outdoor_threshold
    outdoor_labels, _ = ndimage.label(outdoor_mask)
    border_labels = np.unique(np.concatenate((
        outdoor_labels[0], outdoor_labels[-1],
        outdoor_labels[:, 0], outdoor_labels[:, -1],
    )))
    # Do not grow into an unbounded exterior region at the image edge.
    outdoor_mask &= ~np.isin(outdoor_labels, border_labels)

    structures = list(structures) + recover_openings(
        icon_probabilities, structures, scale_x, scale_y
    )
    accepted_structures, review_structures, barriers, doorway_widths = [], [], [], []
    for record in structures:
        shape, kind, index = record["shape"], record["type"], record["class_id"]
        if not shape.is_valid or shape.is_empty or shape.area <= 0:
            continue
        scores = region_scores(
            shape,
            room_probabilities if kind == "wall" else icon_probabilities,
            scale_x,
            scale_y,
        )
        support = (
            float(scores[2] + scores[8]) if kind == "wall" else float(scores[index])
        )
        detail = {
            **record,
            "mean_head_support": support,
            "class_mean_softmax": float(scores[index]),
            "review_reasons": [],
        }
        if support < settings.minimum_structure_support:
            detail["review_reasons"].append("weak_dense_head_agreement")
            review_structures.append(detail)
            continue
        accepted_structures.append(detail)
        if not record.get("requires_verification", False) and (
            kind == "wall" or (kind == "icon" and index in {1, 2})
        ):
            barriers.append(shape)
        if kind == "icon" and index == 2:
            x0, y0, x1, y1 = shape.bounds
            doorway_widths.append(max((x1 - x0) / scale_x, (y1 - y0) / scale_y))
    vector_barrier = unary_union(barriers)
    vector_mask = rasterize(barriers, width, height, scale_x, scale_y)
    wall_grid = room_probabilities[2].astype(np.float32) + room_probabilities[8].astype(
        np.float32
    )

    def regions_at(threshold):
        mask = vector_mask | (wall_grid >= threshold)
        radius = settings.closing_radius
        if radius:
            mask = ndimage.binary_closing(
                mask, structure=np.ones((radius * 2 + 1, radius * 2 + 1))
            )
        original_free = footprint_mask & ~mask
        recovered_free = (footprint_mask | outdoor_mask) & ~mask
        original_labels, _ = ndimage.label(original_free)
        original_areas = np.bincount(original_labels.ravel()) * scale_x * scale_y
        recovered_labels, _ = ndimage.label(recovered_free)
        for label, slices in enumerate(ndimage.find_objects(recovered_labels), 1):
            if slices is None:
                continue
            component = recovered_labels[slices] == label
            old_labels = np.unique(original_labels[slices][component])
            old_labels = old_labels[old_labels != 0]
            if np.count_nonzero(original_areas[old_labels] >= minimum_area) > 1:
                # Dense outdoor evidence must not bridge previously separate rooms.
                recovered_free[slices][component] = original_free[slices][component]
        regions = mask_polygons(recovered_free, scale_x, scale_y, minimum_area)
        return [
            part
            for shape in regions
            for part in polygon_parts(shape.difference(vector_barrier))
            if part.is_valid and part.area >= minimum_area
        ]

    regions = regions_at(settings.wall_threshold)
    alternatives = [
        regions_at(threshold) for threshold in settings.stability_thresholds
    ]
    neck_radius = (
        min(18, max(3, int(np.median(doorway_widths) * 0.55))) if doorway_widths else 8
    )
    instances = []
    for index, shape in enumerate(regions):
        reasons = []
        stability = min(
            max(
                (
                    shape.intersection(other).area / shape.union(other).area
                    for other in alternative
                    if shape.intersects(other)
                ),
                default=0,
            )
            for alternative in alternatives
        )
        if stability < settings.minimum_stability_iou:
            reasons.append("threshold_sensitive_topology")
        cores = [
            part
            for part in polygon_parts(
                shape.buffer(-neck_radius * min(scale_x, scale_y))
            )
            if part.area >= shape.area * 0.10
        ]
        if len(cores) >= 2:
            reasons.append("multiple_large_lobes")
        for ring in shape.interiors:
            hole = Polygon(ring)
            coordinates = list(hole.minimum_rotated_rectangle.exterior.coords)
            lengths = [
                np.linalg.norm(np.asarray(a) - b)
                for a, b in zip(coordinates[:-1], coordinates[1:])
            ]
            if (
                min(lengths) > 0
                and max(lengths) / min(lengths) > 4
                and max(lengths) > 0.2 * np.sqrt(shape.area)
            ):
                reasons.append("unresolved_internal_barrier")
                break
        scores = region_scores(shape, room_probabilities, scale_x, scale_y)
        label = int(scores.argmax())
        instances.append(
            {
                "id": f"R{index + 1:03}",
                "shape": shape,
                "class_id": label,
                "class_mean_softmax": float(scores[label]),
                "class_scores": scores.tolist(),
                "semantics_verified": False,
                "stability_iou": float(stability),
                "review_reasons": reasons,
                "status": "needs_review" if reasons else "passes_structural_checks",
            }
        )
    return {
        "instances": instances,
        "structures": accepted_structures,
        "review_structures": review_structures,
        "minimum_area_px": minimum_area,
        "neck_radius_model_pixels": neck_radius,
        "review_check_meaning": "Heuristic consistency checks; not calibrated correctness probabilities.",
    }
