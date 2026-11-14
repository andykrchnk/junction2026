"""Public response contract and validated worker boundaries."""

import math
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator
from shapely.geometry import shape
from taxonomy import RoomClass, IconClass

Score = Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]
Number = Annotated[float, Field(allow_inf_nan=False)]
Position = tuple[Number, Number]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ImageSize(Model):
    width: int = Field(gt=0)
    height: int = Field(gt=0)


class Polygon(Model):
    type: Literal["Polygon"] = "Polygon"
    coordinates: list[list[Position]]


class MultiPolygon(Model):
    type: Literal["MultiPolygon"] = "MultiPolygon"
    coordinates: list[list[list[Position]]]


Geometry = Annotated[Polygon | MultiPolygon, Field(discriminator="type")]


class Area(Model):
    value: float = Field(gt=0, allow_inf_nan=False)
    unit: Literal["mm²", "cm²", "m²", "km²", "ft²", "in²"]


class Length(Model):
    value: float = Field(gt=0, allow_inf_nan=False)
    unit: Literal["mm", "cm", "m", "km", "ft", "in"]


class RoomMeasurements(Model):
    area: Area | None = None
    length: Length | None = None
    width: Length | None = None
    height: Length | None = None


class FixtureMeasurements(Model):
    width: Length | None = None
    height: Length | None = None


class Room(Model):
    id: str
    class_: RoomClass = Field(alias="class")
    confidence: Score
    name: str | None = None
    geometry: Geometry
    measurements: RoomMeasurements = Field(default_factory=RoomMeasurements)


class Fixture(Model):
    id: str
    class_: IconClass = Field(alias="class")
    confidence: Score
    room_ids: list[str]
    geometry: Geometry
    measurements: FixtureMeasurements = Field(default_factory=FixtureMeasurements)


class ProcessingResponse(Model):
    coordinate_system: Literal["image_pixels"] = "image_pixels"
    image: ImageSize
    rooms: list[Room]
    fixtures: list[Fixture]

    @model_validator(mode="after")
    def validate_objects(self):
        ids = [obj.id for obj in self.rooms + self.fixtures]
        if len(set(ids)) != len(ids):
            raise ValueError("Duplicate object IDs")
        room_ids = {room.id for room in self.rooms}
        for fixture in self.fixtures:
            if not set(fixture.room_ids).issubset(room_ids):
                raise ValueError("Dangling fixture room association")
        for obj in self.rooms + self.fixtures:
            geo = obj.geometry.model_dump()
            rings = (
                geo["coordinates"]
                if geo["type"] == "Polygon"
                else [r for p in geo["coordinates"] for r in p]
            )
            if not rings or any(len(r) < 4 or r[0] != r[-1] for r in rings):
                raise ValueError("Unclosed or empty polygon ring")
            geom = shape(geo)
            if not geom.is_valid or geom.is_empty or geom.area <= 0:
                raise ValueError("Invalid polygon")
            x0, y0, x1, y1 = geom.bounds
            if x0 < 0 or y0 < 0 or x1 > self.image.width or y1 > self.image.height:
                raise ValueError("Geometry outside image")
        return self


class WorkerRecord(BaseModel):
    model_config = ConfigDict(extra="ignore")
    geometry_wkt: str | None = None
    bbox: tuple[Number, Number, Number, Number]
    confidence: Score
    class_: IconClass | None = Field(default=None, alias="class")
    model_label: RoomClass | None = None
    requires_verification: bool = False


class OCRToken(Model):
    polygon: list[Position] = Field(min_length=3)
    text: str = Field(max_length=4096)
    confidence: Score


class WorkerResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    image: ImageSize
    model: dict[str, str]
    room_instances: list[WorkerRecord] | None = None
    room_polygons: dict[RoomClass, list[WorkerRecord]] | None = None
    icon_detections: list[WorkerRecord] | None = None
    review_icon_detections: list[WorkerRecord] | None = None
    ocr: list[OCRToken] | None = None
