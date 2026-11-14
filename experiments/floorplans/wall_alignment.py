"""Bounded geometry-only cleanup. Source lines guide direction; references never enter."""
from dataclasses import asdict, dataclass

import numpy as np
from shapely.geometry import Polygon
from shapely.ops import unary_union


@dataclass(frozen=True)
class AlignmentSettings:
    maximum_tolerance_model_px: float = 3.0
    wall_width_fraction: float = 0.35
    minimum_tolerance_model_px: float = 1.0
    maximum_angle_degrees: float = 3.0
    maximum_relative_area_change: float = 0.02
    maximum_symmetric_difference_fraction: float = 0.04
    maximum_boundary_shift_tolerances: float = 2.0
    overlap_epsilon_model_px2: float = 0.01


def rings(shape):
    return [shape.exterior, *shape.interiors]


def boundary_metrics(shape, short_length):
    lengths = np.concatenate([np.linalg.norm(np.diff(np.asarray(r.coords), axis=0), axis=1) for r in rings(shape)])
    return {
        'vertices': int(len(lengths)),
        'short_segments': int(np.sum(lengths < short_length)),
        'perimeter_model_px': float(shape.length),
        'holes': len(shape.interiors),
    }


def wall_width(walls):
    widths = []
    for shape in walls:
        if shape.is_empty or shape.area <= 0:
            continue
        rectangle = np.asarray(shape.minimum_rotated_rectangle.exterior.coords)
        sides = np.linalg.norm(np.diff(rectangle, axis=0), axis=1)
        if sides.min() >= 1 and sides.max() >= sides.min() * 2:
            widths.append(sides.min())
    return float(np.clip(np.median(widths) if widths else 6, 2, 20))


def line_fit_ring(original, reduced, source_lines, tolerance, thickness, settings):
    points = np.asarray(original.coords)[:-1]
    vertices = np.asarray(reduced.coords)[:-1]
    indices = [int(np.argmin(np.linalg.norm(points - v, axis=1))) for v in vertices]
    equations, supported = [], 0
    for i, a in enumerate(vertices):
        b = vertices[(i + 1) % len(vertices)]
        direction = b - a
        length = np.linalg.norm(direction)
        if length < 1e-8:
            return vertices, 0
        direction /= length
        normal = np.array([-direction[1], direction[0]])
        mid = (a + b) / 2
        start, end = indices[i], indices[(i + 1) % len(indices)]
        chunk = points[start:end + 1] if start < end else np.vstack((points[start:], points[:end + 1]))
        chosen = direction
        if length >= max(6 * tolerance, thickness * 2) and len(source_lines):
            starts, ends = source_lines[:, 0], source_lines[:, 1]
            vectors = ends - starts
            norms = np.linalg.norm(vectors, axis=1)
            units = vectors / norms[:, None]
            alignment = np.abs(units @ direction)
            distance = np.abs(((starts + ends) / 2 - mid) @ normal)
            projections = np.stack(((starts-a) @ direction, (ends-a) @ direction), axis=1)
            overlap = np.minimum(projections.max(axis=1), length) - np.maximum(projections.min(axis=1), 0)
            eligible = (alignment >= np.cos(np.deg2rad(settings.maximum_angle_degrees))) & (distance <= max(tolerance*3, thickness*1.5)) & (overlap >= min(length*.4, 20))
            if eligible.any():
                rank = np.where(eligible, overlap / (1 + distance) * alignment, -1)
                chosen = units[int(rank.argmax())].copy()
                if chosen @ direction < 0:
                    chosen *= -1
                # Exact axes are allowed only when the nearby observed source line supports them.
                if abs(chosen[0]) < np.sin(np.deg2rad(1)):
                    chosen = np.array([0.0, np.sign(chosen[1])])
                elif abs(chosen[1]) < np.sin(np.deg2rad(1)):
                    chosen = np.array([np.sign(chosen[0]), 0.0])
                supported += 1
        normal = np.array([-chosen[1], chosen[0]])
        # Fit the room-side offset; do not move an interior face onto a wall centerline.
        offset = float(np.median(chunk @ normal)) if len(chunk) >= 3 else float(mid @ normal)
        equations.append((normal, offset))
    fitted = []
    for i, vertex in enumerate(vertices):
        n0, d0 = equations[i - 1]
        n1, d1 = equations[i]
        matrix = np.stack([n0, n1])
        if abs(np.linalg.det(matrix)) < 0.06:
            fitted.append(vertex)
            continue
        intersection = np.linalg.solve(matrix, [d0, d1])
        fitted.append(intersection if np.linalg.norm(intersection - vertex) <= tolerance*2 else vertex)
    return np.asarray(fitted), supported


def clean_candidate(shape, barriers, source_lines, tolerance, thickness, settings, fit_lines):
    reduced = shape.simplify(tolerance, preserve_topology=True)
    if reduced.geom_type != 'Polygon' or len(reduced.interiors) != len(shape.interiors):
        return shape, ['simplification_changed_topology'], 0
    supported = 0
    if fit_lines:
        fitted = []
        for old_ring, new_ring in zip(rings(shape), rings(reduced)):
            ring, count = line_fit_ring(old_ring, new_ring, source_lines, tolerance, thickness, settings)
            fitted.append(ring)
            supported += count
        proposal = Polygon(fitted[0], fitted[1:])
    else:
        proposal = reduced
    if not proposal.is_valid or proposal.is_empty:
        return shape, ['invalid_fitted_polygon'], supported
    # Clip against the unchanged vector wall/opening constraints.
    proposal = proposal.difference(barriers)
    reasons = []
    if proposal.geom_type != 'Polygon' or not proposal.is_valid or proposal.is_empty:
        return shape, ['barrier_clipping_changed_topology'], supported
    if len(proposal.interiors) != len(shape.interiors):
        reasons.append('hole_count_changed')
    if abs(proposal.area-shape.area)/shape.area > settings.maximum_relative_area_change:
        reasons.append('area_change_exceeds_limit')
    if proposal.symmetric_difference(shape).area/shape.area > settings.maximum_symmetric_difference_fraction:
        reasons.append('changed_footprint_exceeds_limit')
    if proposal.boundary.hausdorff_distance(shape.boundary) > tolerance*settings.maximum_boundary_shift_tolerances:
        reasons.append('boundary_shift_exceeds_limit')
    if proposal.intersection(barriers).area > settings.overlap_epsilon_model_px2:
        reasons.append('barrier_overlap')
    return (shape if reasons else proposal), reasons, supported


def align_regions(shapes, wall_shapes, barriers, source_lines, settings=AlignmentSettings(), fit_lines=True):
    """All geometry is in cropped model pixels. Keep IDs/topology and reject pair conflicts."""
    thickness = wall_width(wall_shapes)
    tolerance = min(settings.maximum_tolerance_model_px, max(settings.minimum_tolerance_model_px, thickness*settings.wall_width_fraction))
    barrier_union = unary_union(barriers)
    candidates, reports = [], []
    for shape in shapes:
        proposal, reasons, supported = clean_candidate(shape, barrier_union, source_lines, tolerance, thickness, settings, fit_lines)
        candidates.append(proposal)
        reports.append({'rejection_reasons': reasons, 'source_supported_edges': supported})
    # Review neighboring boundaries jointly. Revert conflicting edits; iterate because
    # restoring one original can expose a conflict with another edited neighbor.
    for _ in range(len(shapes) + 1):
        rejected = set()
        for i, a in enumerate(candidates):
            for j in range(i):
                extra = a.intersection(candidates[j]).area - shapes[i].intersection(shapes[j]).area
                shared_length = shapes[i].boundary.intersection(shapes[j].boundary).length
                separated = shared_length > tolerance*2 and a.boundary.distance(candidates[j].boundary) > 0.1
                if extra > settings.overlap_epsilon_model_px2 or separated:
                    for k in [i, j]:
                        if not candidates[k].equals(shapes[k]):
                            rejected.add(k)
        if not rejected:
            break
        for k in rejected:
            candidates[k] = shapes[k]
            reports[k]['rejection_reasons'].append('neighbor_contact_or_overlap_would_change')
    for before, after, report in zip(shapes, candidates, reports):
        report.update({
            'before': boundary_metrics(before, thickness),
            'after': boundary_metrics(after, thickness),
            'accepted_edit': not after.equals(before),
            'area_change_fraction': float((after.area-before.area)/before.area),
            'symmetric_difference_fraction': float(after.symmetric_difference(before).area/before.area),
            'boundary_hausdorff_model_px': float(after.boundary.hausdorff_distance(before.boundary)),
        })
        quality = []
        if report['after']['short_segments'] >= 6 and report['after']['short_segments'] > report['after']['vertices']*.25:
            quality.append('remaining_short_segment_cluster')
        if report['rejection_reasons']:
            quality.append('cleanup_rejected')
        report['boundary_review_reasons'] = quality
    return candidates, {'settings': asdict(settings), 'tolerance_model_px': tolerance, 'estimated_wall_width_model_px': thickness, 'regions': reports}
