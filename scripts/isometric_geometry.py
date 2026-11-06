"""Palette-safe orthographic sprite rasterization from a reviewed structural model.

One logical 32 x 32 ground cell projects to a 32 x 16 diamond.  Geometry is
expressed in cells.  This module guarantees the projection of the supplied
model; it cannot establish the correctness of surfaces absent in a source view.
"""

from __future__ import annotations

import math
import re
from copy import deepcopy
from pathlib import Path
from typing import Any, Dict, Iterable, List, Sequence, Tuple

from PIL import Image


EPS = 1e-7
CELL = 32
PROJECTION = {
    "name": "orthographic_2_to_1",
    "logical_cell_px": CELL,
    "projected_cell_px": [32, 16],
    "basis_x": [16, 8],
    "basis_y": [-16, 8],
    "basis_z": [0, -16],
    "view_direction": [1, 1, 1],
    "vanishing_points": "at infinity; parallel world lines remain parallel",
}


def source_palette(path: Any) -> List[List[int]]:
    """Return exact RGB colors of visible source pixels, most common first.

    Fully transparent pixels have no visible color and are deliberately ignored.
    Partial-alpha source pixels retain their uncomposited RGB value.
    """
    with Image.open(Path(path)) as source:
        counts: Dict[Tuple[int, int, int], int] = {}
        for r, g, b, alpha in source.convert("RGBA").getdata():
            if alpha:
                rgb = (r, g, b)
                counts[rgb] = counts.get(rgb, 0) + 1
    if not counts:
        raise ValueError("The source image has no visible pixels.")
    return [list(rgb) for rgb in sorted(counts, key=lambda rgb: (-counts[rgb], rgb))]


def _palette(palette: Sequence[Sequence[int]]) -> List[Tuple[int, int, int]]:
    if not isinstance(palette, (list, tuple)) or not palette:
        raise ValueError("A nonempty source palette is required.")
    result = []
    for color in palette:
        if not isinstance(color, (list, tuple)) or len(color) != 3 or any(
            isinstance(channel, bool) or not isinstance(channel, int) or not 0 <= channel <= 255
            for channel in color
        ):
            raise ValueError("Palette colors must contain three integer RGB channels.")
        rgb = tuple(color)
        if rgb not in result:
            result.append(rgb)
    return result


def _sub(a: Sequence[float], b: Sequence[float]) -> Tuple[float, ...]:
    return tuple(x - y for x, y in zip(a, b))


def _dot(a: Sequence[float], b: Sequence[float]) -> float:
    return sum(x * y for x, y in zip(a, b))


def _cross(a: Sequence[float], b: Sequence[float]) -> Tuple[float, float, float]:
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _length(a: Sequence[float]) -> float:
    return math.sqrt(_dot(a, a))


def _project(point: Sequence[float]) -> Tuple[float, float]:
    x, y, z = point
    return (16 * (x - y), 8 * (x + y) - 16 * z)


def _color(value: Any) -> Tuple[int, int, int]:
    if not isinstance(value, str) or not re.fullmatch(r"#[0-9A-Fa-f]{6}", value):
        raise ValueError("Face colors must be #RRGGBB strings.")
    return tuple(int(value[i:i + 2], 16) for i in (1, 3, 5))


def _hex(color: Sequence[int]) -> str:
    return "#" + "".join(f"{channel:02x}" for channel in color)


def _geometry(model: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(model, dict) or model.get("schema_version") != 1:
        raise ValueError("A schema_version: 1 structural model is required.")
    footprint = model.get("footprint")
    if not isinstance(footprint, list) or len(footprint) != 2 or any(
        isinstance(n, bool) or not isinstance(n, int) or n <= 0 for n in footprint
    ):
        raise ValueError("footprint must contain two positive whole-cell dimensions.")
    if model.get("cell_size") != CELL:
        raise ValueError("cell_size must be 32 logical pixels.")
    buffer_px = model.get("buffer_px")
    if isinstance(buffer_px, bool) or not isinstance(buffer_px, (int, float)) or not math.isfinite(buffer_px) or buffer_px < 2:
        raise ValueError("buffer_px must be finite and at least 2 logical pixels.")
    inset = buffer_px / CELL
    if inset * 2 >= min(footprint):
        raise ValueError("The requested buffer consumes the entire footprint.")
    raw_vertices = model.get("vertices")
    if not isinstance(raw_vertices, dict) or len(raw_vertices) < 3:
        raise ValueError("The model needs at least three named vertices.")
    vertices: Dict[str, Tuple[float, float, float]] = {}
    for name, point in raw_vertices.items():
        if not isinstance(name, str) or not name or not isinstance(point, (list, tuple)) or len(point) != 3 or any(
            isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in point
        ):
            raise ValueError("Every vertex needs a name and three finite coordinates.")
        vertices[name] = tuple(float(v) for v in point)
    if any(point[2] < -EPS for point in vertices.values()):
        raise ValueError("Vertices may not extend below the ground plane.")
    bounds = [[min(p[axis] for p in vertices.values()), max(p[axis] for p in vertices.values())] for axis in range(3)]
    for axis, size in enumerate(footprint):
        if bounds[axis][0] < inset - EPS or bounds[axis][1] > size - inset + EPS:
            raise ValueError("All geometry, including roof overhangs, must stay inside the buffered footprint.")
        if abs(sum(bounds[axis]) / 2 - size / 2) > 1e-6:
            raise ValueError("The complete geometry must be centered in its footprint.")
    contacts = [point for point in vertices.values() if abs(point[2]) <= EPS]
    if not contacts:
        raise ValueError("The model needs ground-contact vertices at z=0.")
    for axis, size in enumerate(footprint):
        if abs((min(p[axis] for p in contacts) + max(p[axis] for p in contacts)) / 2 - size / 2) > 1e-6:
            raise ValueError("Ground-contact geometry must be centered in the footprint.")
    raw_faces = model.get("faces")
    if not isinstance(raw_faces, list) or not raw_faces:
        raise ValueError("At least one planar convex face is required.")
    faces = []
    face_ids, used = set(), set()
    for face in raw_faces:
        if not isinstance(face, dict) or not isinstance(face.get("id"), str) or not face["id"] or face["id"] in face_ids:
            raise ValueError("Every face needs a unique nonempty id.")
        face_ids.add(face["id"])
        names = face.get("vertices")
        if not isinstance(names, list) or len(names) < 3 or any(not isinstance(n, str) or n not in vertices for n in names) or len(set(names)) != len(names):
            raise ValueError("Face vertices must be distinct existing vertex names.")
        points = [vertices[name] for name in names]
        if len(set(points)) != len(points):
            raise ValueError("A face cannot repeat a vertex position.")
        normal = None
        for i in range(1, len(points) - 1):
            candidate = _cross(_sub(points[i], points[0]), _sub(points[i + 1], points[0]))
            if _length(candidate) > EPS:
                normal = candidate
                break
        if normal is None:
            raise ValueError("Face polygons must have nonzero surface area.")
        n_length = _length(normal)
        if any(abs(_dot(_sub(point, points[0]), normal)) > EPS * n_length for point in points):
            raise ValueError("Face polygons must be planar.")
        # For a convex polygon every other point lies on the same side of each
        # oriented boundary edge. This also rejects self-intersecting orders.
        orientation = None
        for i, point in enumerate(points):
            edge = _sub(points[(i + 1) % len(points)], point)
            for other in points:
                side = _dot(_cross(edge, _sub(other, point)), normal)
                if abs(side) <= EPS * n_length:
                    continue
                sign = 1 if side > 0 else -1
                if orientation is not None and sign != orientation:
                    raise ValueError("Face polygons must be convex and consistently ordered.")
                orientation = sign
        if orientation is None:
            raise ValueError("Face polygons must have nonzero surface area.")
        faces.append({"id": face["id"], "vertices": list(names), "color": _color(face.get("color")), "role": str(face.get("role", "structure"))})
        used.update(names)
    if used != set(vertices):
        raise ValueError("Every declared vertex must belong to a face.")
    return {"footprint": footprint, "buffer_px": float(buffer_px), "vertices": vertices, "faces": faces, "bounds": bounds}


def _layout(geometry: Dict[str, Any]) -> Dict[str, Any]:
    width, depth = geometry["footprint"]
    floor = [_project(point) for point in [(0, 0, 0), (width, 0, 0), (width, depth, 0), (0, depth, 0)]]
    projected = {name: _project(point) for name, point in geometry["vertices"].items()}
    # Keep the complete ground diamond. Only opaque geometry needs a crop
    # margin: padding the diamond too would needlessly double a 1-cell canvas.
    bounds = []
    for axis in (0, 1):
        bounds.append([
            min(min(point[axis] for point in floor), min(point[axis] for point in projected.values()) - 2),
            max(max(point[axis] for point in floor), max(point[axis] for point in projected.values()) + 2),
        ])
    size = [max(CELL, math.ceil((high - low - EPS) / CELL) * CELL) for low, high in bounds]
    if size[0] * size[1] > 16_777_216:
        raise ValueError("The projected sprite exceeds the 16 megapixel raster limit.")
    origin = [(extent - (high + low)) / 2 for extent, (low, high) in zip(size, bounds)]
    return {"size": size, "origin": origin, "projected": projected, "floor": floor}


def _near(a: Any, b: Any, epsilon: float = 1e-6) -> bool:
    if isinstance(a, (list, tuple)) and isinstance(b, (list, tuple)):
        return len(a) == len(b) and all(_near(x, y, epsilon) for x, y in zip(a, b))
    return isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool) and math.isfinite(a) and math.isfinite(b) and abs(a - b) <= epsilon


def _offset(point: Sequence[float], origin: Sequence[float]) -> List[float]:
    return [point[0] + origin[0], point[1] + origin[1]]


def _edge_records(geometry: Dict[str, Any], projected: Dict[str, List[float]]) -> List[Dict[str, Any]]:
    edges = []
    seen = set()
    for face in geometry["faces"]:
        names = face["vertices"]
        for a, b in zip(names, names[1:] + names[:1]):
            key = tuple(sorted((a, b)))
            if key in seen:
                continue
            seen.add(key)
            delta = _sub(geometry["vertices"][b], geometry["vertices"][a])
            family = next((label for axis, label in enumerate(("x", "y", "z")) if all(abs(delta[i]) < EPS for i in range(3) if i != axis)), "model_diagonal")
            edges.append({"vertices": [a, b], "world_delta": list(delta), "projected": [projected[a], projected[b]], "family": family})
    return edges


def render_model(model: Dict[str, Any], palette: Sequence[Sequence[int]]) -> Tuple[Image.Image, Dict[str, Any]]:
    """Rasterize the model with pixel-center sampling and a per-pixel z-buffer.

    Later coplanar detail faces replace earlier faces at equal depth. All faces
    use solid source-palette colors, so no unprojected texture lines are added.
    """
    colors = _palette(palette)
    geometry = _geometry(model)
    layout = _layout(geometry)
    width, height = layout["size"]
    origin = layout["origin"]
    projected = {name: _offset(point, origin) for name, point in layout["projected"].items()}
    image = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    pixels = image.load()
    z_buffer = [float("-inf")] * (width * height)
    face_colors = []
    for face in geometry["faces"]:
        requested = face["color"]
        used = min(colors, key=lambda color: sum((a - b) ** 2 for a, b in zip(color, requested)))
        face_colors.append({"id": face["id"], "requested": _hex(requested), "used": _hex(used), "distance": math.sqrt(sum((a - b) ** 2 for a, b in zip(used, requested)))})
        names = face["vertices"]
        for index in range(1, len(names) - 1):
            tri = [names[0], names[index], names[index + 1]]
            a, b, d = [projected[name] for name in tri]
            denom = (b[1] - d[1]) * (a[0] - d[0]) + (d[0] - b[0]) * (a[1] - d[1])
            if abs(denom) <= EPS:  # A legitimately edge-on face has no pixels.
                continue
            depths = [sum(geometry["vertices"][name]) for name in tri]
            min_x = max(0, math.floor(min(a[0], b[0], d[0])))
            max_x = min(width - 1, math.ceil(max(a[0], b[0], d[0])))
            min_y = max(0, math.floor(min(a[1], b[1], d[1])))
            max_y = min(height - 1, math.ceil(max(a[1], b[1], d[1])))
            for y in range(min_y, max_y + 1):
                py = y + .5
                for x in range(min_x, max_x + 1):
                    px = x + .5
                    wa = ((b[1] - d[1]) * (px - d[0]) + (d[0] - b[0]) * (py - d[1])) / denom
                    wb = ((d[1] - a[1]) * (px - d[0]) + (a[0] - d[0]) * (py - d[1])) / denom
                    wc = 1 - wa - wb
                    if min(wa, wb, wc) < -EPS:
                        continue
                    depth = wa * depths[0] + wb * depths[1] + wc * depths[2]
                    slot = y * width + x
                    if depth >= z_buffer[slot] - EPS:
                        pixels[x, y] = (*used, 255)
                        z_buffer[slot] = depth
    footprint_center = [geometry["footprint"][0] / 2, geometry["footprint"][1] / 2, 0]
    metadata = {
        "schema_version": 1,
        "projection": deepcopy(PROJECTION),
        "canvas": {"width": width, "height": height, "origin": origin},
        "ground_anchor": _offset(_project(footprint_center), origin),
        "footprint": list(geometry["footprint"]),
        "buffer_px": geometry["buffer_px"],
        "footprint_polygon": [_offset(point, origin) for point in layout["floor"]],
        "geometry_bounds": geometry["bounds"],
        "projected_vertices": projected,
        "edges": _edge_records(geometry, projected),
        "face_colors": face_colors,
        "visible_bbox": list(image.getbbox()) if image.getbbox() else None,
        "visible_pixel_count": sum(alpha > 0 for alpha in image.getchannel("A").getdata()),
        "assumptions": list(model.get("assumptions", [])),
        "source_features": list(model.get("source_features", [])),
    }
    return image, metadata


def validate_output(image: Image.Image, model: Dict[str, Any], palette: Sequence[Sequence[int]], metadata: Dict[str, Any]) -> Dict[str, Any]:
    """Audit colors, geometry, anchoring, and recorded projection independently.

    The pixel appearance check re-renders the supplied model. This binds a valid
    geometric certificate to the actual PNG and catches arbitrary painted lines,
    moved pixels, or stale metadata rather than trusting geometry alone.
    """
    checks: List[Dict[str, Any]] = []
    def check(name: str, passed: bool, details: Any = None) -> None:
        row = {"name": name, "passed": bool(passed)}
        if details is not None:
            row["details"] = details
        checks.append(row)
    report = {
        "passed": False,
        "checks": checks,
        "scope": "Exact source-palette membership and orthographic projection of every declared structural/detail polygon. Hidden surfaces are inferred; source-view fidelity requires visual review.",
    }
    try:
        colors = set(_palette(palette))
    except (TypeError, ValueError) as error:
        check("source_palette", False, str(error))
        return report
    try:
        rgba = image.convert("RGBA")
    except (AttributeError, ValueError) as error:
        check("rgba_image", False, str(error))
        return report
    visible = [pixel for pixel in rgba.getdata() if pixel[3]]
    check("nonempty_sprite", bool(visible))
    added = sorted({pixel[:3] for pixel in visible} - colors)
    check("exact_source_palette", not added, {"added_colors": [list(rgb) for rgb in added], "visible_colors": len({pixel[:3] for pixel in visible})})
    check("binary_alpha", all(pixel[3] in (0, 255) for pixel in rgba.getdata()))
    try:
        geometry = _geometry(model)
        layout = _layout(geometry)
    except (TypeError, ValueError, KeyError, OverflowError) as error:
        check("valid_centered_buffered_mesh", False, str(error))
        return report
    check("valid_centered_buffered_mesh", True, {"geometry_bounds": geometry["bounds"], "buffer_px": geometry["buffer_px"], "footprint": geometry["footprint"]})
    width, height = layout["size"]
    origin = layout["origin"]
    check("32px_canvas_increments", rgba.size == (width, height) and width % CELL == height % CELL == 0, {"expected": [width, height], "actual": list(rgba.size)})
    if not isinstance(metadata, dict):
        check("metadata", False, "Metadata must be an object.")
        return report
    projection = metadata.get("projection", {})
    check("orthographic_camera", projection == PROJECTION)
    canvas = metadata.get("canvas", {})
    check("canvas_metadata", isinstance(canvas, dict) and canvas.get("width") == width and canvas.get("height") == height and _near(canvas.get("origin"), origin))
    projected = {name: _offset(point, origin) for name, point in layout["projected"].items()}
    supplied = metadata.get("projected_vertices", {})
    check("projected_vertices", isinstance(supplied, dict) and set(supplied) == set(projected) and all(_near(supplied[name], point) for name, point in projected.items()))
    expected_anchor = _offset(_project([geometry["footprint"][0] / 2, geometry["footprint"][1] / 2, 0]), origin)
    check("centered_ground_anchor", _near(metadata.get("ground_anchor"), expected_anchor), {"expected": expected_anchor, "actual": metadata.get("ground_anchor")})
    expected_floor = [_offset(point, origin) for point in layout["floor"]]
    check("whole_footprint_recorded", _near(metadata.get("footprint_polygon"), expected_floor) and metadata.get("footprint") == geometry["footprint"] and _near(metadata.get("buffer_px"), geometry["buffer_px"]))
    check("geometry_bounds_recorded", _near(metadata.get("geometry_bounds"), geometry["bounds"]))
    edges = metadata.get("edges")
    expected_edges = _edge_records(geometry, projected)
    edge_ok = isinstance(edges, list) and len(edges) == len(expected_edges)
    if edge_ok:
        edge_ok = all(isinstance(edge, dict) and edge.get("vertices") == expected["vertices"] and edge.get("family") == expected["family"] and _near(edge.get("world_delta"), expected["world_delta"]) and _near(edge.get("projected"), expected["projected"]) for edge, expected in zip(edges, expected_edges))
    check("all_structural_edges_match_projection", edge_ok, {"edge_count": len(expected_edges)})
    parallel_pairs = 0
    parallel_ok = edge_ok
    if edge_ok:
        for i, edge in enumerate(edges):
            for other in edges[i + 1:]:
                a, b = edge["world_delta"], other["world_delta"]
                if _length(_cross(a, b)) > EPS * _length(a) * _length(b):
                    continue
                parallel_pairs += 1
                u = _sub(edge["projected"][1], edge["projected"][0])
                v = _sub(other["projected"][1], other["projected"][0])
                if abs(u[0] * v[1] - u[1] * v[0]) > EPS * max(1, _length(u) * _length(v)):
                    parallel_ok = False
    check("parallel_world_edge_families", parallel_ok, {"parallel_pairs": parallel_pairs, "roof_diagonals": "checked from their own 3D direction"})
    bbox = rgba.getbbox()
    # A 2px geometric margin should leave at least one full transparent pixel
    # around the actual raster, even for fractional camera placement.
    check("opaque_pixels_not_clipped", bbox is not None and bbox[0] >= 1 and bbox[1] >= 1 and bbox[2] <= width - 1 and bbox[3] <= height - 1, {"visible_bbox": list(bbox) if bbox else None})
    check("visible_bbox_recorded", metadata.get("visible_bbox") == (list(bbox) if bbox else None) and metadata.get("visible_pixel_count") == len(visible))
    expected_image, expected_metadata = render_model(model, palette)
    check("face_colors_recorded", metadata.get("face_colors") == expected_metadata["face_colors"])
    check("pixels_match_projected_geometry", rgba.size == expected_image.size and all(
        actual[3] == expected[3] and (actual[3] == 0 or actual[:3] == expected[:3])
        for actual, expected in zip(rgba.getdata(), expected_image.getdata())
    ))
    report["passed"] = all(row["passed"] for row in checks)
    report["statistics"] = {"visible_pixels": len(visible), "source_palette_colors": len(colors), "used_colors": len({pixel[:3] for pixel in visible}), "structural_edges": len(expected_edges), "parallel_edge_pairs": parallel_pairs}
    return report
