import base64
import io
from PIL import ImageDraw
from shapely import wkt
from shapely.geometry import box, Point
from taxonomy import STRUCTURAL_CLASSES


def targets(worker, image):
    result = []
    seen_geometries = set()
    rooms = worker.room_instances
    if rooms is None:
        rooms = []
        for label, rows in (worker.room_polygons or {}).items():
            rooms.extend(row.model_copy(update={"model_label": label}) for row in rows)
    icons = (worker.icon_detections or []) + (worker.review_icon_detections or [])
    for kind, rows in [("room", rooms), ("fixture", icons)]:
        for row in rows:
            label = row.model_label if kind == "room" else row.class_
            if label is None:
                raise ValueError("Missing worker class")
            label = label.value
            if label in STRUCTURAL_CLASSES or label == "No Icon":
                continue
            if kind == "room" and not row.geometry_wkt:
                raise ValueError("Room polygon missing from geometry worker")
            geometry = (
                wkt.loads(row.geometry_wkt) if row.geometry_wkt else box(*row.bbox)
            )
            if (
                not geometry.is_valid
                or geometry.is_empty
                or geometry.geom_type not in {"Polygon", "MultiPolygon"}
                or geometry.area <= 0
            ):
                continue
            key = (kind, label, geometry.normalize().wkb)
            if key in seen_geometries:
                continue
            seen_geometries.add(key)
            x0, y0, x1, y1 = geometry.bounds
            if x0 < 0 or y0 < 0 or x1 > image.width or y1 > image.height:
                continue
            result.append(
                {
                    "kind": kind,
                    "class": label,
                    "confidence": row.confidence,
                    "geometry": geometry,
                    "measurements": {},
                    "name": None,
                    "requires_verification": row.requires_verification,
                    **({"decision": "removed"} if row.requires_verification else {}),
                }
            )
    return result


def image_part(image):
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return {
        "type": "image",
        "data": base64.b64encode(buffer.getvalue()).decode(),
        "mime_type": "image/png",
        "resolution": "high",
    }


def room_fixture_context(room, fixtures):
    verified = []
    unresolved_count = 0
    for fixture in fixtures:
        if fixture.get("decision") == "removed":
            continue
        fraction = (
            room["geometry"].intersection(fixture["geometry"]).area
            / fixture["geometry"].area
        )
        # Require most of the fixture to lie inside the room. Mere adjacency or
        # a small overlap must not import another room's functional evidence.
        if fraction <= 0.5:
            continue
        resolution = fixture.get("verification", {})
        if resolution.get("resolution") != "resolved":
            unresolved_count += 1
            continue
        verified.append(
            {
                "class": fixture["class"],
                "class_score": resolution["selected_class_score"],
                "existence_score": resolution["existence_score"],
                "class_basis": resolution["class_basis"],
                "bounds": list(fixture["geometry"].bounds),
                "fraction_inside_room": fraction,
            }
        )
    verified.sort(key=lambda item: item["class_score"], reverse=True)
    return {
        "verified": verified[:64],
        "verified_count": len(verified),
        "unresolved_count": unresolved_count,
    }


def crop_parts(image, geom, bounds):
    clean = image.crop(bounds)
    marked = clean.copy()
    draw = ImageDraw.Draw(marked)
    for poly in list(geom.geoms) if geom.geom_type == "MultiPolygon" else [geom]:
        for ring in [poly.exterior, *poly.interiors]:
            draw.line(
                [(x - bounds[0], y - bounds[1]) for x, y in ring.coords],
                fill="#c000b5",
                width=2,
            )
    clean.thumbnail((1600, 1600))
    marked.thumbnail((1600, 1600))
    return [image_part(clean), image_part(marked)]


def context(target, image, ocr, overview, *, closeup=False):
    geom = target["geometry"]
    x0, y0, x1, y1 = geom.bounds
    pad = (
        max(96, 2 * max(x1 - x0, y1 - y0))
        if target["kind"] == "fixture"
        else max(45, 0.14 * max(x1 - x0, y1 - y0))
    )
    bounds = (
        max(0, int(x0 - pad)),
        max(0, int(y0 - pad)),
        min(image.width, int(x1 + pad + 1)),
        min(image.height, int(y1 + pad + 1)),
    )
    tokens = []
    for token in ocr:
        cx = sum(p[0] for p in token.polygon) / len(token.polygon)
        cy = sum(p[1] for p in token.polygon) / len(token.polygon)
        if bounds[0] <= cx <= bounds[2] and bounds[1] <= cy <= bounds[3]:
            tokens.append(
                {
                    "text": token.text,
                    "confidence": token.confidence,
                    "polygon": token.polygon,
                    "center_in_target": geom.covers(Point(cx, cy)),
                }
            )
    parts = [*crop_parts(image, geom, bounds), overview]
    if closeup:
        # Crop from the source, not the resized contextual image, so small basin
        # and seating details survive a second look at large fixture candidates.
        detail_pad = max(24, 0.25 * max(x1 - x0, y1 - y0))
        detail_bounds = (
            max(0, int(x0 - detail_pad)),
            max(0, int(y0 - detail_pad)),
            min(image.width, int(x1 + detail_pad + 1)),
            min(image.height, int(y1 + detail_pad + 1)),
        )
        parts = [
            {
                "type": "text",
                "text": (
                    "Close-up from the source image, clean then magenta target; "
                    "followed by contextual clean/marked crops and sheet overview. "
                    "Distinguish tubs, shower trays/screens, sauna seating and cabinets. "
                    "If views remain unclear "
                    "choose ambiguous."
                ),
            },
            *crop_parts(image, geom, detail_bounds),
            *parts,
        ]
    return parts, tokens, bounds
