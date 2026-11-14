from shapely.geometry import mapping
from schemas import ProcessingResponse


def normalize(image, targets):
    rooms = []
    fixtures = []
    room_geometries = []
    for target in targets:
        if target.get("decision") == "removed":
            continue
        collection = rooms if target["kind"] == "room" else fixtures
        identifier = f"{target['kind']}-{len(collection)+1:03d}"
        measurements = {
            key: target["measurements"].get(key)
            for key in (
                ["area", "length", "width", "height"]
                if target["kind"] == "room"
                else ["width", "height"]
            )
        }
        entry = {
            "id": identifier,
            "class": target["class"],
            "confidence": target["confidence"],
            "geometry": mapping(target["geometry"]),
            "measurements": measurements,
        }
        if target["kind"] == "room":
            entry["name"] = target["name"]
            room_geometries.append((identifier, target["geometry"]))
        else:
            entry["room_ids"] = []
        collection.append(entry)
    kept_icons = [
        t for t in targets if t["kind"] == "fixture" and t.get("decision") != "removed"
    ]
    for entry, target in zip(fixtures, kept_icons):
        # Associate only actual overlap or <=2px adjacency; unknown is safer than nearest-room guessing.
        entry["room_ids"] = [
            rid
            for rid, geom in room_geometries
            if geom.intersection(target["geometry"]).area > 0
            or geom.distance(target["geometry"]) <= 2
        ]
    return ProcessingResponse.model_validate(
        {
            "coordinate_system": "image_pixels",
            "image": {"width": image.width, "height": image.height},
            "rooms": rooms,
            "fixtures": fixtures,
        }
    )
