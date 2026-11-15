"""Read the authoritative pure-data definitions without importing torch."""

import ast
from enum import Enum
from pathlib import Path

SOURCE = Path(__file__).resolve().parent.parent / "cubicasa/model/segmentation_net.py"
if not SOURCE.exists():
    SOURCE = Path("/app/source_taxonomy.py")
values = {}
for node in ast.parse(SOURCE.read_text()).body:
    if isinstance(node, ast.Assign):
        for target in node.targets:
            if isinstance(target, ast.Name) and target.id in {
                "ROOM_CLASSES",
                "ICON_CLASSES",
            }:
                values[target.id] = ast.literal_eval(node.value)
ROOM_CLASSES = tuple(values["ROOM_CLASSES"])
ICON_CLASSES = tuple(values["ICON_CLASSES"])
if len(ROOM_CLASSES) != 12 or len(ICON_CLASSES) != 11:
    raise RuntimeError(
        "CubiCasa taxonomy changed: review the response contract before deploying"
    )
RoomClass = Enum(
    "RoomClass", {f"C{i}": v for i, v in enumerate(ROOM_CLASSES)}, type=str
)
IconClass = Enum(
    "IconClass", {f"C{i}": v for i, v in enumerate(ICON_CLASSES)}, type=str
)
# Application output classes can extend the verifier vocabulary without changing
# pretrained channels or accepting invented classes from the geometry worker.
FIXTURE_CLASSES = ICON_CLASSES + ("Shower Cabin",)
FixtureClass = Enum(
    "FixtureClass", {f"C{i}": v for i, v in enumerate(FIXTURE_CLASSES)}, type=str
)
STRUCTURAL_CLASSES = {"Background", "Wall", "Railing"}


# Service extensions are resolved after inference; worker labels remain unchanged.
SERVICE_ROOM_CLASSES = ROOM_CLASSES + ("Sauna", "Balcony")
ServiceRoomClass = Enum(
    "ServiceRoomClass",
    {f"C{i}": v for i, v in enumerate(SERVICE_ROOM_CLASSES)},
    type=str,
)
