"""Codex adapter provenance and lifecycle tests; no live model calls."""

import importlib.util
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from PIL import Image


SPEC = importlib.util.spec_from_file_location("isometric_codex_under_test", Path(__file__).resolve().parents[1] / "scripts/isometric_codex.py")
codex = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(codex)
THREAD = "01234567-1234-1234-1234-0123456789ab"


class NativeArtifactChecks(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="isometric-provenance-test-")
        self.root = Path(self.temporary.name)
        self.native_root = self.root / ".codex" / "generated_images" / THREAD
        self.native_root.mkdir(parents=True)
        self.proposal = self.root / "proposal.png"
        self.native = self.native_root / "generated.png"
        self.started_at = time.time() - 1
        Image.new("RGBA", (4, 4), (200, 40, 40, 255)).save(self.proposal)
        self.native.write_bytes(self.proposal.read_bytes())

    def tearDown(self):
        self.temporary.cleanup()

    def proof(self, thread=THREAD):
        # Mock only this module's dependency; never rewrite HOME/CODEX_HOME or
        # use the real authentication/config directory for a test fixture.
        fake_os = SimpleNamespace(environ={})
        with patch.object(codex, "os", fake_os), patch.object(codex.Path, "home", return_value=self.root):
            return codex._native_imagegen_artifact(self.proposal, thread, self.started_at)

    def test_current_thread_matching_fresh_native_png_proves_artifact_origin(self):
        proof = self.proof()
        self.assertEqual(proof["proof_mode"], "current-thread-generated-artifact")
        self.assertEqual(proof["thread_id"], THREAD)
        self.assertEqual(Path(proof["native_generated_path"]), self.native.resolve())
        self.assertEqual(proof["native_generated_sha256"], codex.hashlib.sha256(self.proposal.read_bytes()).hexdigest())
        self.assertGreaterEqual(proof["native_generated_mtime"], self.started_at)

    def test_other_thread_or_path_traversal_cannot_supply_proof(self):
        self.assertFalse(self.proof("11234567-1234-1234-1234-0123456789ab"))
        self.assertFalse(self.proof("../../other-thread"))

    def test_different_proposal_hash_cannot_inherit_native_provenance(self):
        Image.new("RGBA", (4, 4), (40, 200, 40, 255)).save(self.native)
        self.assertFalse(self.proof())

    def test_native_file_from_before_the_run_is_rejected(self):
        old = self.started_at - 10
        os.utime(self.native, (old, old))
        self.assertFalse(self.proof())

    def test_symlinked_native_file_and_thread_directory_are_rejected(self):
        self.native.unlink()
        self.native.symlink_to(self.proposal)
        self.assertFalse(self.proof())
        self.native.unlink()
        self.native_root.rmdir()
        outside = self.root / "outside"
        outside.mkdir()
        (outside / "generated.png").write_bytes(self.proposal.read_bytes())
        self.native_root.symlink_to(outside, target_is_directory=True)
        self.assertFalse(self.proof())

    def test_non_png_bytes_cannot_prove_a_generated_image(self):
        self.proposal.write_bytes(b"not a PNG")
        self.native.write_bytes(self.proposal.read_bytes())
        self.assertFalse(self.proof())


class EventChecks(unittest.TestCase):
    def test_native_generation_completion_shapes_are_detected(self):
        for kind, path_key in (("imageGeneration", "savedPath"), ("image_generation", "saved_path"), ("image_generation_call", "saved_path")):
            with self.subTest(kind=kind):
                event = {"type": "item.completed", "item": {"type": kind, "status": "completed", path_key: "/native/output.png", "result": "opaque result"}}
                evidence = codex._imagegen_evidence(event)
                self.assertEqual(len(evidence), 1)
                self.assertEqual(evidence[0]["saved_path"], "/native/output.png")
        self.assertTrue(codex._imagegen_evidence({"type": "image_generation_end", "result": "opaque result"}))

    def test_failed_or_unfinished_native_generation_is_not_completion_proof(self):
        self.assertFalse(codex._imagegen_evidence({"type": "item.completed", "item": {
            "type": "imageGeneration", "status": "failed", "failure": "error", "result": "error",
        }}))
        self.assertFalse(codex._imagegen_evidence({"type": "item.started", "item": {
            "type": "imageGeneration", "status": "inProgress",
        }}))

    def test_agent_assertions_and_shell_output_are_never_tool_proof(self):
        for kind in ("agent_message", "command_execution"):
            event = {"type": "item.completed", "item": {
                "type": kind, "text": "Called tools.image_gen__imagegen() and completed imageGeneration",
                "aggregated_output": '{"type":"imageGeneration","status":"completed","result":"pretend"}',
            }}
            self.assertFalse(codex._imagegen_evidence(event))

    def test_direct_and_exec_wrapped_structured_tool_calls_are_detected(self):
        self.assertTrue(codex._imagegen_evidence({"type": "item.completed", "item": {
            "type": "mcp_tool_call", "server": "image_gen", "tool": "imagegen", "status": "completed",
        }}))
        self.assertTrue(codex._imagegen_evidence({"type": "item.completed", "item": {
            "type": "function_call", "name": "functions.exec", "arguments": "await tools.image_gen__imagegen({});",
        }}))

    def test_logs_omit_image_bytes_and_secret_fields(self):
        result = codex._safe_log({
            "authorization": "sensitive value",
            "content": [{"type": "image", "mimeType": "image/png", "data": "base64image"}],
            "url": "data:image/png;base64,aGVsbG8=",
            "message": "Bearer abc.def.ghi",
        })
        serialized = json.dumps(result)
        for secret in ("sensitive value", "base64image", "aGVsbG8=", "abc.def.ghi"):
            self.assertNotIn(secret, serialized)


class WorkerLifecycleChecks(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="isometric-worker-test-")
        self.root = Path(self.temporary.name)
        self.source = self.root / "source.png"
        Image.new("RGBA", (2, 2), (200, 40, 40, 255)).save(self.source)
        self.worker = self.root / "fake-codex"
        self.worker.write_text(f"#!{sys.executable}\n" + '''
import json, os, pathlib, sys, time
from PIL import Image
prompt = sys.stdin.read()
out = pathlib.Path.cwd()
(out / 'worker.pid').write_text(str(os.getpid()))
if prompt == 'timeout': time.sleep(30)
if prompt == 'failure': sys.exit(7)
image = out / 'generated.png'
Image.new('RGBA', (2,2), (200,40,40,255)).save(image)
response = {'generated_image_path': str(image), 'model': {'schema_version':1}}
if prompt == 'model-file':
    model = {'schema_version':1, 'faces':[{'id':'continuous', 'vertices':['v'+str(i) for i in range(14)]}]}
    (out / 'reviewed-model.json').write_text(json.dumps(model))
    response['model'] = 'reviewed-model.json'
pathlib.Path(sys.argv[sys.argv.index('-o')+1]).write_text(json.dumps(response))
print(json.dumps({'type':'item.completed', 'item':{'type':'mcp_tool_call', 'server':'image_gen', 'tool':'imagegen', 'status':'completed'}}), flush=True)
print(json.dumps({'type':'turn.completed'}), flush=True)
''')
        self.worker.chmod(0o755)

    def tearDown(self):
        self.temporary.cleanup()

    def run_worker(self, prompt, timeout=10):
        with patch.object(codex.shutil, "which", return_value=str(self.worker)):
            return codex.run_codex(self.source, self.root / "output", {"prompt": prompt, "schema": {"type": "object"}}, timeout=timeout)

    def test_success_validates_png_and_failed_rerun_cannot_use_old_response(self):
        response = self.run_worker("success")
        self.assertTrue(response["codex_provenance"]["observed_builtin_imagegen_call"])
        self.assertTrue(Path(response["generated_image_path"]).is_file())
        self.assertEqual(response["model"], {"schema_version": 1})
        with self.assertRaisesRegex(codex.CodexGenerationError, "status 7"):
            self.run_worker("failure")
        self.assertFalse((self.root / "output" / "codex-response.json").exists())

    def test_timeout_stops_only_the_owned_worker(self):
        with self.assertRaisesRegex(codex.CodexGenerationError, "timed out"):
            self.run_worker("timeout", timeout=1)
        pid = int((self.root / "output" / "worker.pid").read_text())
        with self.assertRaises(ProcessLookupError):
            os.kill(pid, 0)
        # This test process remains alive; no global process-name killing.
        self.assertGreater(os.getpid(), 0)

    def test_model_file_preserves_large_face_and_records_exact_reviewed_bytes(self):
        response = self.run_worker("model-file")
        self.assertEqual(response["model"]["faces"][0]["vertices"], [f"v{i}" for i in range(14)])
        provenance = response["codex_provenance"]
        reviewed = self.root / "output" / "reviewed-model.json"
        self.assertEqual(provenance["reviewed_model_path"], str(reviewed.resolve()))
        self.assertEqual(provenance["reviewed_model_sha256"], hashlib.sha256(reviewed.read_bytes()).hexdigest())


if __name__ == "__main__":
    unittest.main()
