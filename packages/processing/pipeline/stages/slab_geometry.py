"""Bounded line-derived gross outlines; no model-generated vertices."""
import numpy as np
from PIL import ImageDraw
from scipy import ndimage as ndi
from skimage import measure, morphology
from shapely.geometry import Polygon, box
from shapely.ops import unary_union
from shapely.affinity import scale


def candidates(image):
    raster = image.copy()
    raster.thumbnail((2048, 2048))
    a = np.asarray(raster.convert("L"))
    height, width = a.shape
    found = []
    for threshold in (170, 200, 225):
        ink = a < threshold
        horizontal = ndi.binary_opening(ndi.binary_closing(ink, structure=np.ones((1, 9))), structure=np.ones((1, 65)))
        vertical = ndi.binary_opening(ndi.binary_closing(ink, structure=np.ones((9, 1))), structure=np.ones((65, 1)))
        labels, _ = ndi.label(~ndi.binary_dilation(horizontal | vertical, iterations=2))
        base = np.zeros_like(ink)
        for region in measure.regionprops(labels):
            y0, x0, y1, x1 = region.bbox
            if (region.area < 2500 or x0 == 0 or y0 == 0 or x1 == width or y1 == height
                    or x1-x0 > .85*width or y1-y0 > .85*height or min(y1-y0, x1-x0) < 25):
                continue
            base[labels == region.label] = True
        for radius in (0, 3, 6, 10):
            mask = ndi.binary_closing(base, structure=morphology.disk(radius)) if radius else base
            labels, _ = ndi.label(mask)
            for region in measure.regionprops(labels):
                if region.area < 5000:
                    continue
                y0, x0, y1, x1 = region.bbox
                if x1-x0 > .85*width or y1-y0 > .85*height:
                    continue
                local = ndi.binary_fill_holes(labels[y0:y1, x0:x1] == region.label)
                contours = measure.find_contours(np.pad(local, 1), .5)
                if not contours:
                    continue
                poly = Polygon([(float(x+x0-1), float(y+y0-1)) for y, x in max(contours, key=len)]).simplify(2, preserve_topology=True)
                if not poly.is_valid or poly.area < 5000:
                    continue
                if any(poly.intersection(other).area / poly.union(other).area > .96 for other in found):
                    continue
                found.append(poly)
                if len(found) >= 120:
                    break
            if len(found) >= 120:
                break
        if len(found) >= 120:
            break
    found.sort(key=lambda g: g.area, reverse=True)
    return {f"C{i+1:03}": scale(g, xfact=image.width/width, yfact=image.height/height, origin=(0, 0)) for i, g in enumerate(found)}


def assemble(groups, catalog, image):
    result = []
    for group in groups:
        shapes = [catalog[key] for key in dict.fromkeys(group.candidate_ids)]
        union = unary_union(shapes)
        geometry = union
        if group.gap_pixels:
            distance = group.gap_pixels/2 + .1
            geometry = geometry.buffer(distance, join_style=2).buffer(-distance, join_style=2)
        if geometry.geom_type != "Polygon":
            continue
        geometry = Polygon(geometry.exterior).simplify(1, preserve_topology=True)
        if (not geometry.is_valid or geometry.is_empty or not box(0, 0, *image.size).covers(geometry)
                or geometry.area > sum(g.area for g in shapes)*1.10):
            continue
        if any(geometry.intersection(g).area > 1 for _, g in result):
            continue
        result.append((group, geometry))
    return result


def overlay(image, geometries):
    marked = image.copy()
    marked.thumbnail((1600, 1600))
    draw = ImageDraw.Draw(marked)
    for label, geometry in geometries:
        geometry = scale(geometry, xfact=marked.width/image.width, yfact=marked.height/image.height, origin=(0, 0))
        draw.line(list(geometry.exterior.coords), fill="#d62250", width=3)
        point = geometry.representative_point()
        draw.text((point.x, point.y), label, fill="#d62250")
    marked.thumbnail((1600, 1600))
    return marked
