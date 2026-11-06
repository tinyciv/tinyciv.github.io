"""Regression tests for geometry/palette guarantees, including corrupted output."""

import importlib.util
from pathlib import Path
import tempfile
import unittest

from PIL import Image

SPEC = importlib.util.spec_from_file_location("isometric_geometry", Path(__file__).resolve().parents[1] / "scripts/isometric_geometry.py")
geometry = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(geometry)

PALETTE = [[200, 40, 40], [128, 24, 24], [240, 120, 80], [48, 16, 16]]


def tent(width=1, depth=1):
    left, right = .1, width - .1
    back, front = .1, depth - .1
    mid = width / 2
    return {
        "schema_version": 1, "footprint": [width, depth], "cell_size": 32, "buffer_px": 2,
        "vertices": {"a": [left, back, 0], "b": [right, back, 0], "c": [right, front, 0], "d": [left, front, 0], "e": [mid, back, .85], "f": [mid, front, .85]},
        "faces": [
            {"id": "back", "vertices": ["a", "b", "e"], "color": "#801818", "role": "canvas"},
            {"id": "left", "vertices": ["a", "e", "f", "d"], "color": "#f07850", "role": "canvas"},
            {"id": "right", "vertices": ["e", "b", "c", "f"], "color": "#c82828", "role": "canvas"},
            {"id": "front", "vertices": ["d", "f", "c"], "color": "#c82828", "role": "canvas"},
        ],
        "assumptions": ["The unseen back follows the visible triangular front."],
        "source_features": ["Red canvas, triangular gable, long ridge."],
    }


class GeometryChecks(unittest.TestCase):
    def render(self, model=None):
        model = model or tent()
        image, metadata = geometry.render_model(model, PALETTE)
        return model, image, metadata

    def passes(self, model, image, metadata):
        report = geometry.validate_output(image, model, PALETTE, metadata)
        self.assertTrue(report["passed"], [row for row in report["checks"] if not row["passed"]])

    def fails(self, model, image, metadata, name):
        report = geometry.validate_output(image, model, PALETTE, metadata)
        self.assertFalse(report["passed"])
        self.assertFalse(next(row["passed"] for row in report["checks"] if row["name"] == name))

    def test_native_tent_is_32_square_with_exact_palette(self):
        model, image, metadata = self.render()
        self.assertEqual(image.size, (32, 32))
        self.passes(model, image, metadata)
        self.assertEqual(metadata["projection"]["projected_cell_px"], [32, 16])

    def test_palette_excludes_invisible_rgb_but_keeps_source_color(self):
        image = Image.new("RGBA", (3, 1))
        image.putdata([(1, 2, 3, 255), (4, 5, 6, 128), (7, 8, 9, 0)])
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "source.png"
            image.save(path)
            self.assertEqual(geometry.source_palette(path), [[1, 2, 3], [4, 5, 6]])

    def test_new_visible_color_is_rejected(self):
        model, image, metadata = self.render()
        image.putpixel((16, 16), (0, 255, 0, 255))
        self.fails(model, image, metadata, "exact_source_palette")

    def test_partial_alpha_is_rejected(self):
        model, image, metadata = self.render()
        image.putpixel((16, 16), (*PALETTE[0], 128))
        self.fails(model, image, metadata, "binary_alpha")

    def test_invisible_rgb_does_not_invalidate_palette_or_geometry(self):
        model, image, metadata = self.render()
        image.putpixel((0, 0), (1, 2, 3, 0))
        self.passes(model, image, metadata)

    def test_new_line_using_allowed_colors_still_fails_geometry(self):
        model, image, metadata = self.render()
        for y in range(5, 15):
            image.putpixel((4, y), (*PALETTE[0], 255))
        self.fails(model, image, metadata, "pixels_match_projected_geometry")

    def test_empty_output_is_rejected(self):
        model, image, metadata = self.render()
        image = Image.new("RGBA", image.size)
        self.fails(model, image, metadata, "nonempty_sprite")

    def test_palette_quantization_never_adds_colors(self):
        model = tent()
        model["faces"][0]["color"] = "#0000ff"
        _, image, metadata = self.render(model)
        self.passes(model, image, metadata)
        self.assertGreater(metadata["face_colors"][0]["distance"], 0)

    def test_translation_inside_border_is_still_rejected(self):
        model = tent()
        for point in model["vertices"].values():
            point[0] += .02
        with self.assertRaisesRegex(ValueError, "centered"):
            geometry.render_model(model, PALETTE)

    def test_roof_overhang_outside_buffer_is_rejected(self):
        model = tent()
        model["vertices"]["e"][0] = .01
        with self.assertRaisesRegex(ValueError, "buffered footprint"):
            geometry.render_model(model, PALETTE)

    def test_ground_contact_center_is_checked_separately(self):
        model = tent()
        # The centered roof keeps total bounds centered while the feet shift.
        for name in ["a", "b", "c", "d"]:
            model["vertices"][name][0] += .02
        model["vertices"]["g"] = [.1, .5, .2]
        model["faces"].append({"id": "detail", "vertices": ["g", "e", "f"], "color": "#c82828"})
        model["vertices"]["h"] = [.92, .5, .2]
        model["faces"].append({"id": "detail2", "vertices": ["h", "e", "f"], "color": "#c82828"})
        # Adjust left extension to balance all geometry, without moving feet.
        model["vertices"]["g"][0] = .08
        with self.assertRaisesRegex(ValueError, "Ground-contact"):
            geometry.render_model(model, PALETTE)

    def test_tampered_line_certificate_is_rejected(self):
        model, image, metadata = self.render()
        metadata["edges"][0]["projected"][0][0] += 2
        self.fails(model, image, metadata, "all_structural_edges_match_projection")

    def test_finite_perspective_camera_is_rejected(self):
        model, image, metadata = self.render()
        metadata["projection"]["name"] = "perspective"
        self.fails(model, image, metadata, "orthographic_camera")

    def test_tampered_camera_basis_does_not_mutate_expected_camera(self):
        model, image, metadata = self.render()
        metadata["projection"]["basis_x"][1] = 9
        self.fails(model, image, metadata, "orthographic_camera")
        self.assertEqual(geometry.PROJECTION["basis_x"], [16, 8])

    def test_malformed_projection_metadata_fails_without_crashing(self):
        model, image, metadata = self.render()
        metadata["ground_anchor"] = 1
        self.fails(model, image, metadata, "centered_ground_anchor")

    def test_zbuffer_keeps_nearer_surface_when_draw_order_changes(self):
        model = tent()
        model["vertices"] = {
            "a": [.1, .1, 0], "b": [.9, .1, 0], "c": [.9, .9, 0], "d": [.1, .9, 0],
            "e": [.2, .2, 0], "f": [.6, .2, 0], "g": [.2, .6, 0],
            "h": [.4, .4, .2], "i": [.8, .4, .2], "j": [.4, .8, .2],
        }
        model["faces"] = [
            {"id": "floor", "vertices": ["a", "b", "c", "d"], "color": "#301010"},
            {"id": "far", "vertices": ["e", "f", "g"], "color": "#801818"},
            {"id": "near", "vertices": ["h", "i", "j"], "color": "#f07850"},
        ]
        first, metadata = geometry.render_model(model, PALETTE)
        model["faces"].reverse()
        second, _ = geometry.render_model(model, PALETTE)
        ox, oy = metadata["canvas"]["origin"]
        pixel = (round(ox), round(oy + 5))
        self.assertEqual(first.getpixel(pixel), (*PALETTE[2], 255))
        self.assertEqual(second.getpixel(pixel), (*PALETTE[2], 255))

    def test_roof_diagonal_is_valid_and_not_mistaken_for_grid_axis(self):
        model, image, metadata = self.render()
        diagonals = [e for e in metadata["edges"] if e["family"] == "model_diagonal"]
        self.assertTrue(diagonals)
        for edge in diagonals:
            a, b = edge["projected"]
            slope = (b[1] - a[1]) / (b[0] - a[0])
            self.assertGreater(min(abs(slope - .5), abs(slope + .5)), .1)
        self.passes(model, image, metadata)

    def test_multi_cell_footprints_scale_without_clipping(self):
        for size in [(2, 1), (2, 2), (3, 2)]:
            with self.subTest(size=size):
                model, image, metadata = self.render(tent(*size))
                self.assertGreaterEqual(image.width, 16 * sum(size))
                self.assertEqual(image.width % 32, 0)
                self.assertEqual(image.height % 32, 0)
                self.passes(model, image, metadata)

    def test_ground_anchor_is_not_padded_sprite_bottom(self):
        model, image, metadata = self.render()
        ox, oy = metadata["canvas"]["origin"]
        self.assertEqual(metadata["ground_anchor"], [ox, oy + 8])
        self.assertNotEqual(metadata["ground_anchor"][1], image.height)
        metadata["ground_anchor"][0] += 1
        self.fails(model, image, metadata, "centered_ground_anchor")

    def test_nonplanar_quad_and_concave_polygon_are_rejected(self):
        model = tent()
        model["vertices"]["e"][2] += .1
        with self.assertRaisesRegex(ValueError, "planar"):
            geometry.render_model(model, PALETTE)
        model = tent()
        model["vertices"]["g"] = [.5, .5, 0]
        model["faces"].append({"id": "floor", "vertices": ["a", "b", "g", "c", "d"], "color": "#c82828"})
        with self.assertRaisesRegex(ValueError, "convex"):
            geometry.render_model(model, PALETTE)

    def test_missing_unused_nonfinite_vertices_and_empty_palette_fail_closed(self):
        model = tent()
        model["vertices"]["unused"] = [.5, .5, .2]
        with self.assertRaisesRegex(ValueError, "Every declared vertex"):
            geometry.render_model(model, PALETTE)
        model = tent()
        model["vertices"]["a"][0] = float("nan")
        with self.assertRaisesRegex(ValueError, "finite"):
            geometry.render_model(model, PALETTE)
        with self.assertRaisesRegex(ValueError, "nonempty source palette"):
            geometry.render_model(tent(), [])


if __name__ == "__main__":
    unittest.main()
