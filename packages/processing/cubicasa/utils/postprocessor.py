"""Geometry-aware post-processing for CubiCasa5K outputs."""

from dataclasses import dataclass, field
from typing import Dict, List, Tuple

import numpy as np
import torch
import torch.nn.functional as F
from scipy import ndimage
from shapely import affinity
from shapely.geometry import Polygon
from skimage import measure

from model.segmentation_net import ICON_CLASSES, OUTPUT_SPLIT, ROOM_CLASSES
from utils.preprocessor import ImageTransform

WALL_CLASS_IDX = ROOM_CLASSES.index("Wall")
ROOM_JUNCTION_HEATMAPS = 13


@dataclass(frozen=True)
class IconDetection:
    class_name: str
    centroid_y: float
    centroid_x: float
    area_px: float
    confidence: float
    bbox: Tuple[float, float, float, float]


@dataclass
class SegmentationResult:
    """Dense source-space masks plus compact model-space probabilities."""

    room_mask: np.ndarray
    icon_mask: np.ndarray
    wall_mask: np.ndarray
    room_confidence: np.ndarray
    icon_confidence: np.ndarray
    room_probabilities: np.ndarray
    icon_probabilities: np.ndarray
    heatmap_probabilities: np.ndarray
    transform: ImageTransform
    room_polygons: Dict[str, List[Polygon]] = field(default_factory=dict)
    room_polygon_confidences: Dict[str, List[float]] = field(default_factory=dict)
    icon_detections: List[IconDetection] = field(default_factory=list)
    junctions: List[Tuple[float, float, float]] = field(default_factory=list)


class PostProcessor:
    """Convert network outputs to masks, vectors, detections and confidence."""

    def __init__(
        self,
        min_room_area: int = 500,
        polygon_simplify_tolerance: float = 2.0,
        min_icon_area: int = 50,
        junction_threshold: float = 0.4,
    ):
        self.min_room_area = min_room_area
        self.polygon_simplify_tolerance = polygon_simplify_tolerance
        self.min_icon_area = min_icon_area
        self.junction_threshold = junction_threshold

    def process(
        self,
        output: torch.Tensor,
        transform: ImageTransform,
    ) -> SegmentationResult:
        """Process a ``(1, 44, H, W)`` raw model output."""
        output = _ensure_3d(output).float().cpu()
        heatmaps, room_logits, icon_logits = torch.split(output, OUTPUT_SPLIT, dim=0)
        row_slice, column_slice = transform.content_slices

        heatmap_probabilities = heatmaps[:, row_slice, column_slice].numpy()
        room_probabilities = torch.softmax(
            room_logits[:, row_slice, column_slice], dim=0
        ).numpy()
        icon_probabilities = torch.softmax(
            icon_logits[:, row_slice, column_slice], dim=0
        ).numpy()

        room_mask_model = room_probabilities.argmax(axis=0).astype(np.int32)
        icon_mask_model = icon_probabilities.argmax(axis=0).astype(np.int32)
        room_confidence_model = room_probabilities.max(axis=0).astype(np.float32)
        icon_confidence_model = icon_probabilities.max(axis=0).astype(np.float32)

        source_size = (transform.original_height, transform.original_width)
        room_mask = _resize_array(room_mask_model, source_size, mode="nearest").astype(np.uint8)
        icon_mask = _resize_array(icon_mask_model, source_size, mode="nearest").astype(np.uint8)
        room_confidence = _resize_array(
            room_confidence_model, source_size, mode="bilinear"
        ).astype(np.float32)
        icon_confidence = _resize_array(
            icon_confidence_model, source_size, mode="bilinear"
        ).astype(np.float32)
        wall_mask = (room_mask == WALL_CLASS_IDX).astype(np.uint8)

        scale_x = transform.original_width / transform.content_width
        scale_y = transform.original_height / transform.content_height
        room_area_scale = transform.content_width * transform.content_height / (
            transform.original_width * transform.original_height
        )
        effective_room_area = max(
            self.min_room_area,
            round(transform.original_width * transform.original_height * 0.0005),
        ) * room_area_scale
        effective_icon_area = max(
            self.min_icon_area,
            round(transform.original_width * transform.original_height * 0.00002),
        ) * room_area_scale

        junctions_model = self._extract_junctions(heatmap_probabilities)
        polygons, polygon_confidences = self._vectorize_rooms(
            room_mask_model,
            room_probabilities,
            junctions_model,
            effective_room_area,
            scale_x,
            scale_y,
        )
        icon_detections = self._detect_icons(
            icon_mask_model,
            icon_probabilities,
            effective_icon_area,
            scale_x,
            scale_y,
        )
        junctions = [
            (y * scale_y, x * scale_x, confidence)
            for y, x, confidence in junctions_model
        ]

        return SegmentationResult(
            room_mask=room_mask,
            icon_mask=icon_mask,
            wall_mask=wall_mask,
            room_confidence=room_confidence,
            icon_confidence=icon_confidence,
            room_probabilities=room_probabilities.astype(np.float32),
            icon_probabilities=icon_probabilities.astype(np.float32),
            heatmap_probabilities=heatmap_probabilities.astype(np.float32),
            transform=transform,
            room_polygons=polygons,
            room_polygon_confidences=polygon_confidences,
            icon_detections=icon_detections,
            junctions=junctions,
        )

    def _extract_junctions(
        self,
        heatmap_probabilities: np.ndarray,
    ) -> List[Tuple[float, float, float]]:
        structural = heatmap_probabilities[:ROOM_JUNCTION_HEATMAPS].max(axis=0)
        local_maxima = structural == ndimage.maximum_filter(structural, size=5)
        peak_y, peak_x = np.nonzero(local_maxima & (structural >= self.junction_threshold))
        return [
            (float(y), float(x), float(structural[y, x]))
            for y, x in zip(peak_y, peak_x)
        ]

    def _vectorize_rooms(
        self,
        room_mask: np.ndarray,
        room_probabilities: np.ndarray,
        junctions: List[Tuple[float, float, float]],
        min_area: float,
        scale_x: float,
        scale_y: float,
    ) -> Tuple[Dict[str, List[Polygon]], Dict[str, List[float]]]:
        polygons: Dict[str, List[Polygon]] = {}
        confidences: Dict[str, List[float]] = {}

        for class_index, class_name in enumerate(ROOM_CLASSES):
            if class_index in {0, WALL_CLASS_IDX}:
                continue

            labeled, component_count = ndimage.label(room_mask == class_index)
            class_polygons: List[Polygon] = []
            class_confidences: List[float] = []
            for component_id in range(1, component_count + 1):
                component = labeled == component_id
                if component.sum() < min_area:
                    continue
                polygon = self._mask_to_polygon(component, junctions, min_area)
                if polygon is None:
                    continue
                class_polygons.append(affinity.scale(polygon, scale_x, scale_y, origin=(0, 0)))
                class_confidences.append(float(room_probabilities[class_index][component].mean()))

            if class_polygons:
                polygons[class_name] = class_polygons
                confidences[class_name] = class_confidences

        return polygons, confidences

    def _mask_to_polygon(
        self,
        binary_mask: np.ndarray,
        junctions: List[Tuple[float, float, float]],
        min_area: float,
    ) -> Polygon | None:
        contours = measure.find_contours(binary_mask.astype(float), level=0.5)
        if not contours:
            return None

        contour = max(contours, key=len)
        if len(contour) < 4:
            return None

        polygon = Polygon((point[1], point[0]) for point in contour)
        if not polygon.is_valid:
            polygon = polygon.buffer(0)
        polygon = polygon.simplify(
            self.polygon_simplify_tolerance,
            preserve_topology=True,
        )
        if polygon.is_empty or polygon.area < min_area or polygon.geom_type != "Polygon":
            return None

        snapped_coordinates = [
            _snap_to_junction(x, y, junctions)
            for x, y in polygon.exterior.coords
        ]
        snapped = Polygon(snapped_coordinates)
        if snapped.is_valid and not snapped.is_empty and snapped.area >= min_area:
            return snapped
        return polygon

    def _detect_icons(
        self,
        icon_mask: np.ndarray,
        icon_probabilities: np.ndarray,
        min_area: float,
        scale_x: float,
        scale_y: float,
    ) -> List[IconDetection]:
        detections: List[IconDetection] = []
        for class_index, class_name in enumerate(ICON_CLASSES):
            if class_index == 0:
                continue
            labeled, _ = ndimage.label(icon_mask == class_index)
            for region in measure.regionprops(labeled):
                if region.area < min_area:
                    continue
                component = labeled == region.label
                min_y, min_x, max_y, max_x = region.bbox
                detections.append(
                    IconDetection(
                        class_name=class_name,
                        centroid_y=float(region.centroid[0] * scale_y),
                        centroid_x=float(region.centroid[1] * scale_x),
                        area_px=float(region.area * scale_x * scale_y),
                        confidence=float(icon_probabilities[class_index][component].mean()),
                        bbox=(
                            float(min_x * scale_x),
                            float(min_y * scale_y),
                            float(max_x * scale_x),
                            float(max_y * scale_y),
                        ),
                    )
                )
        return detections


def _snap_to_junction(
    x: float,
    y: float,
    junctions: List[Tuple[float, float, float]],
    maximum_distance: float = 8.0,
) -> Tuple[float, float]:
    if not junctions:
        return x, y
    nearest = min(junctions, key=lambda point: (point[1] - x) ** 2 + (point[0] - y) ** 2)
    distance_squared = (nearest[1] - x) ** 2 + (nearest[0] - y) ** 2
    if distance_squared <= maximum_distance**2:
        return nearest[1], nearest[0]
    return x, y


def _ensure_3d(tensor: torch.Tensor) -> torch.Tensor:
    return tensor.squeeze(0) if tensor.dim() == 4 else tensor


def _resize_array(array: np.ndarray, size: Tuple[int, int], mode: str) -> np.ndarray:
    tensor = torch.from_numpy(array).unsqueeze(0).unsqueeze(0).float()
    options = {"size": size, "mode": mode}
    if mode == "bilinear":
        options["align_corners"] = False
    return F.interpolate(tensor, **options).squeeze().numpy()
