"""CLI regressions for source identity, replay provenance, and complete outputs.

The backend is replaced with a local PNG/model fixture; these tests never call
Codex or imagegen. Live generation is exercised separately by the tent run.
"""

from contextlib import redirect_stdout
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
try:
    SPEC = importlib.util.spec_from_file_location("isometric_asset_under_test", ROOT / "scripts/isometric_asset.py")
    asset = importlib.util.module_from_spec(SPEC)
    SPEC.loader.exec_module(asset)
finally:
    sys.path.pop(0)


PALETTE = [(200, 40, 40), (128, 24, 24), (240, 120, 80), (48, 16, 16)]


def model_fixture():
    return {
        "schema_version": 1, "footprint": [1, 1], "cell_size": 32, "buffer_px": 2,
        "vertices": [
            {"id": "a", "position": [.1, .1, 0]},
            {"id": "b", "position": [.9, .1, 0]},
            {"id": "c", "position": [.9, .9, 0]},
            {"id": "d", "position": [.1, .9, 0]},
            {"id": "e", "position": [.5, .1, .85]},
            {"id": "f", "position": [.5, .9, .85]},
        ],
        "faces": [
            {"id": "back", "vertices": ["a", "b", "e"], "color": "#801818", "role": "canvas"},
            {"id": "left", "vertices": ["a", "e", "f", "d"], "color": "#f07850", "role": "canvas"},
            {"id": "right", "vertices": ["e", "b", "c", "f"], "color": "#c82828", "role": "canvas"},
            {"id": "front", "vertices": ["d", "f", "c"], "color": "#c82828", "role": "canvas"},
        ],
        "assumptions": ["The back repeats the visible triangular end."],
        "source_features": ["Red cloth, triangular front, long ridge."],
    }


class AssetWrapperChecks(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="isometric-asset-test-")
        self.root = Path(self.temporary.name)
        self.source = self.root / "tent.png"
        image = Image.new("RGBA", (8, 8))
        for y in range(8):
            for x in range(8):
                image.putpixel((x, y), (*PALETTE[(x + y) % 4], 255))
        image.save(self.source)

    def tearDown(self):
        self.temporary.cleanup()

    def backend(self, source, output, job, timeout=900):
        self.assertTrue(Path(source).is_file())
        self.assertIn("image_gen__imagegen", job["prompt"])
        self.assertEqual(job["schema"]["type"], "object")
        output = Path(output)
        generated = output / "imagegen-proposal.png"
        Image.new("RGBA", (48, 48), (*PALETTE[0], 255)).save(generated)
        event = {"type": "item.completed", "item": {
            "type": "mcp_tool_call", "server": "image_gen", "tool": "imagegen", "status": "completed",
        }}
        (output / "events.jsonl").write_text(json.dumps(event) + "\n")
        (output / "generation-prompt.txt").write_text(job["prompt"])
        return {
            "generated_image_path": str(generated),
            "model": model_fixture(),
            "visual_review": {"preserves_identity": True, "consistent_view": True, "issues": []},
            "codex_provenance": {
                "backend": "codex-exec", "observed_builtin_imagegen_call": True,
                "imagegen_evidence": [{"event_type": "item.completed", "item_type": "mcp_tool_call", "tool": "imagegen"}],
                "events_path": str(output / "events.jsonl"),
            },
        }

    def invoke(self, output="result", extra=(), backend=None, source=None):
        destination = self.root / output
        args = [str(source or self.source), "--output", str(destination), *map(str, extra)]
        with patch.object(asset, "run_codex", side_effect=backend or self.backend) as generation, redirect_stdout(io.StringIO()):
            code = asset.main(args)
        return destination, code, generation

    def test_fake_backend_runs_complete_32px_pipeline_and_self_contained_review(self):
        output, code, generation = self.invoke()
        self.assertEqual(code, 0)
        generation.assert_called_once()
        with Image.open(output / "isometric.png") as final:
            self.assertEqual(final.size, (32, 32))
            self.assertEqual(final.format, "PNG")
            visible = {pixel[:3] for pixel in final.convert("RGBA").getdata() if pixel[3]}
            self.assertTrue(visible <= set(PALETTE))
        report = json.loads((output / "validation.json").read_text())
        self.assertTrue(report["passed"], report)
        metadata = json.loads((output / "metadata.json").read_text())
        self.assertEqual(metadata["sprite_sha256"], asset.sha256(output / "isometric.png"))
        self.assertEqual(metadata["source_crop_sha256"], asset.sha256(output / "source.png"))
        review = (output / "review.html").read_text()
        self.assertIn("data:image/png;base64,", review)
        self.assertIn("Footprint and neighboring cells", review)
        self.assertIn("32 × 32 pixels", review)
        self.assertNotIn("__DATA__", review)
        self.assertNotIn('src="http', review)

    def test_atlas_crop_controls_palette_not_other_atlas_cells(self):
        atlas = Image.new("RGBA", (12, 8), (0, 255, 0, 255))
        with Image.open(self.source) as source:
            atlas.paste(source, (2, 0))
        source = self.root / "atlas.png"
        atlas.save(source)
        output, _, _ = self.invoke(extra=("--atlas-rect", "2,0,8,8"), source=source)
        palette = json.loads((output / "palette.json").read_text())
        self.assertEqual({tuple(c) for c in palette["colors"]}, set(PALETTE))
        self.assertNotIn([0, 255, 0], palette["colors"])
        with Image.open(output / "source.png") as crop, Image.open(self.source) as expected:
            self.assertEqual(crop.size, (8, 8))
            self.assertEqual(crop.tobytes(), expected.tobytes())

    def test_prepare_only_never_calls_backend(self):
        output, _, generation = self.invoke(extra=("--prepare-only",))
        generation.assert_not_called()
        self.assertTrue((output / "job.json").is_file())
        self.assertTrue((output / "source-reference.png").is_file())
        self.assertFalse((output / "isometric.png").exists())

    def test_existing_output_cannot_be_overwritten(self):
        output = self.root / "existing"
        output.mkdir()
        sentinel = output / "isometric.png"
        sentinel.write_bytes(b"previous asset")
        with self.assertRaisesRegex(ValueError, "empty"):
            self.invoke(output="existing")
        self.assertEqual(sentinel.read_bytes(), b"previous asset")

    def test_duplicate_vertex_ids_are_rejected_without_silent_replacement(self):
        model = model_fixture()
        model["vertices"].append({"id": "a", "position": [.2, .2, 0]})
        with self.assertRaisesRegex(ValueError, "Duplicate vertex"):
            asset.normalize_model(model)

    def test_requested_footprint_resolution_and_buffer_cannot_be_changed(self):
        for field, value in (("footprint", [2, 1]), ("cell_size", 64), ("buffer_px", 3)):
            with self.subTest(field=field):
                def changed(*args, **kwargs):
                    response = self.backend(*args, **kwargs)
                    response["model"][field] = value
                    return response
                with self.assertRaisesRegex(ValueError, "footprint, resolution, or buffer"):
                    self.invoke(output=f"changed-{field}", backend=changed)

    def test_invalid_mesh_is_rejected_before_final_sprite_is_written(self):
        def changed(*args, **kwargs):
            response = self.backend(*args, **kwargs)
            response["model"]["faces"][0]["vertices"][0] = "missing"
            return response
        with self.assertRaisesRegex(ValueError, "existing vertex"):
            self.invoke(output="invalid-mesh", backend=changed)
        self.assertFalse((self.root / "invalid-mesh" / "isometric.png").exists())

    def test_failed_identity_review_is_rejected(self):
        def changed(*args, **kwargs):
            response = self.backend(*args, **kwargs)
            response["visual_review"]["preserves_identity"] = False
            return response
        with self.assertRaisesRegex(ValueError, "Visual reconstruction review failed"):
            self.invoke(output="failed-review", backend=changed)

    def test_reuse_of_valid_proposal_does_not_regenerate_and_is_deterministic(self):
        original, _, _ = self.invoke(output="original")
        reused, _, generation = self.invoke(output="reused", extra=("--reuse-proposal", original / "proposal.json"))
        generation.assert_not_called()
        self.assertEqual((original / "isometric.png").read_bytes(), (reused / "isometric.png").read_bytes())

    def test_reuse_rejects_different_source_even_with_the_same_palette(self):
        original, _, _ = self.invoke(output="original")
        other = self.root / "other.png"
        with Image.open(self.source) as image:
            image.putpixel((0, 0), (*PALETTE[1], 255))
            image.save(other)
        with self.assertRaisesRegex(ValueError, "source crop"):
            self.invoke(output="wrong-source", source=other, extra=("--reuse-proposal", original / "proposal.json"))

    def test_reuse_rejects_different_atlas_crop_even_with_the_same_palette(self):
        atlas = Image.new("RGBA", (16, 8))
        with Image.open(self.source) as image:
            atlas.paste(image, (0, 0))
            image.putpixel((0, 0), (*PALETTE[1], 255))
            atlas.paste(image, (8, 0))
        source = self.root / "atlas.png"
        atlas.save(source)
        original, _, _ = self.invoke(output="atlas-first", source=source, extra=("--atlas-rect", "0,0,8,8"))
        with self.assertRaisesRegex(ValueError, "source crop"):
            self.invoke(output="atlas-other", source=source, extra=("--atlas-rect", "8,0,8,8", "--reuse-proposal", original / "proposal.json"))

    def test_reuse_rejects_image_path_outside_the_old_job(self):
        original, _, _ = self.invoke(output="original")
        response_path = original / "proposal.json"
        response = json.loads(response_path.read_text())
        response["generated_image_path"] = str(self.source)
        response_path.write_text(json.dumps(response))
        with self.assertRaisesRegex(ValueError, "inside.*proposal directory"):
            self.invoke(output="escaped", extra=("--reuse-proposal", response_path))

    def test_backend_without_actual_imagegen_evidence_cannot_claim_a_generation(self):
        def changed(*args, **kwargs):
            response = self.backend(*args, **kwargs)
            response["codex_provenance"]["observed_builtin_imagegen_call"] = False
            response["codex_provenance"]["imagegen_evidence"] = []
            return response
        with self.assertRaisesRegex(ValueError, "(?i)(imagegen|provenance|evidence)"):
            self.invoke(output="unproven", backend=changed)

    def test_reuse_rejects_changed_generated_image(self):
        original, _, _ = self.invoke(output="original")
        Image.new("RGBA", (48, 48), (*PALETTE[1], 255)).save(original / "imagegen-proposal.png")
        with self.assertRaisesRegex(ValueError, "(?i)(hash|changed|match|provenance)"):
            self.invoke(output="changed-image", extra=("--reuse-proposal", original / "proposal.json"))

    def test_reuse_rejects_changed_reconstruction_mesh(self):
        original, _, _ = self.invoke(output="original")
        response_path = original / "proposal.json"
        response = json.loads(response_path.read_text())
        response["model"]["vertices"][4]["position"][2] = .75
        response["model"]["vertices"][5]["position"][2] = .75
        response_path.write_text(json.dumps(response))
        with self.assertRaisesRegex(ValueError, "(?i)(hash|changed|match|provenance)"):
            self.invoke(output="changed-mesh", extra=("--reuse-proposal", response_path))


if __name__ == "__main__":
    unittest.main()
