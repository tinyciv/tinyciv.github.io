"""Small, authenticated Codex CLI adapter for the isometric asset converter.

The caller owns the prompt and JSON schema. No API keys, model overrides, or
permission bypasses are introduced here. Image generation remains a Codex tool
call; Pillow is used only to verify the returned PNG.
"""

from __future__ import annotations

import json
import hashlib
import os
from pathlib import Path
import queue
import re
import shutil
import signal
import subprocess
import threading
import time
from typing import Any

from PIL import Image


class CodexGenerationError(RuntimeError):
    """The Codex worker did not produce a usable local image and model."""


_SECRET_KEY = re.compile(
    r"^(?:api[-_]?key|access[-_]?token|refresh[-_]?token|authorization|"
    r"password|secret|client[-_]?secret)$", re.I
)
_DATA_URL = re.compile(r"data:[\w.+/-]+;base64,[A-Za-z0-9+/=\s]+")
_BEARER = re.compile(r"\bBearer\s+[A-Za-z0-9._~+/-]+=*", re.I)
_OPENAI_KEY = re.compile(r"\bsk-[A-Za-z0-9_-]{16,}\b")
_BASE64 = re.compile(r"^[A-Za-z0-9+/=\s]+$")
_GENERATOR_CALL = re.compile(r"\b(?:tools\.)?image_gen__imagegen\s*\(")
_THREAD_ID = re.compile(r"^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$")


def _safe_log(value: Any, key: str = "") -> Any:
    """Keep useful events without copying embedded images or credential fields."""
    if _SECRET_KEY.match(key):
        return "<redacted>"
    if isinstance(value, dict):
        image_content = str(value.get("mimeType", "")).startswith("image/") or value.get("type") == "image"
        return {
            k: "<image bytes omitted>" if image_content and k in ("data", "blob") else _safe_log(v, k)
            for k, v in value.items()
        }
    if isinstance(value, list):
        return [_safe_log(v) for v in value]
    if isinstance(value, str):
        if len(value) > 4096 and _BASE64.fullmatch(value):
            return "<base64 bytes omitted>"
        value = _DATA_URL.sub("<embedded image omitted>", value)
        return _OPENAI_KEY.sub("<redacted>", _BEARER.sub("Bearer <redacted>", value))
    return value


def _imagegen_evidence(event: dict[str, Any]) -> list[dict[str, str]]:
    """Look for actual tool events, never an agent merely saying 'imagegen'.

    Codex versions expose different event shapes. Absence is reported as unknown
    evidence, not a generation failure: some versions omit nested tool events.
    """
    found: list[dict[str, str]] = []

    def visit(node: Any) -> None:
        if isinstance(node, list):
            for child in node:
                visit(child)
            return
        if not isinstance(node, dict):
            return
        kind = str(node.get("type", ""))
        name = str(node.get("tool_name", node.get("tool", node.get("name", ""))))
        server = str(node.get("server", ""))
        tool_event = kind in {"mcp_tool_call", "dynamic_tool_call", "tool_call", "function_call", "custom_tool_call"}
        direct = name in {"image_gen__imagegen", "image_gen.imagegen", "imagegen"} and (tool_event or "image_gen" in server)
        arguments = node.get("arguments", node.get("input", node.get("code", "")))
        arguments = arguments if isinstance(arguments, str) else json.dumps(arguments)
        wrapped = tool_event and name in {"exec", "functions.exec"} and bool(_GENERATOR_CALL.search(arguments))
        native = kind in {"image_generation", "imageGeneration", "image_generation_call", "image_generation_end"}
        completed = str(node.get("status", "")).lower() in {"completed", "complete", "success", "succeeded"}
        # A native completion contains a generated result/path, not a tool name.
        native = native and not node.get("failure") and not node.get("error") and (
            completed or kind == "image_generation_end"
        ) and bool(node.get("result") or node.get("saved_path") or node.get("savedPath"))
        if direct or wrapped or native:
            row = {"event_type": str(event.get("type", "")), "item_type": kind, "tool": "imagegen" if native else name or server}
            saved_path = node.get("saved_path", node.get("savedPath"))
            if isinstance(saved_path, str):
                row["saved_path"] = saved_path
            found.append(row)
        # Agent text and shell output are not proof that a tool was called.
        for key, child in node.items():
            if key not in {"text", "output", "aggregated_output", "arguments", "input", "code"}:
                visit(child)

    visit(event)
    return found


def _native_imagegen_artifact(image_path: Path, thread_id: str | None, started_at: float) -> dict[str, Any]:
    """Match the returned PNG against this run's native imagegen output cache.

    Some ``codex exec --json`` versions omit native imagegen events. Their image
    tool still saves outputs under CODEX_HOME/generated_images/<thread UUID>/.
    A match is accepted only for the thread ID from the CLI's thread.started
    event, a regular non-symlink PNG created/modified during this invocation, and
    byte-for-byte equality with the returned proposal. Agent messages and copy
    commands are deliberately not accepted as provenance.
    """
    if not isinstance(thread_id, str) or not _THREAD_ID.fullmatch(thread_id):
        return {}
    codex_home = Path(os.environ.get("CODEX_HOME", str(Path.home() / ".codex"))).expanduser()
    native_root = codex_home / "generated_images" / thread_id
    if not native_root.is_dir() or native_root.is_symlink():
        return {}
    digest = hashlib.sha256(Path(image_path).read_bytes()).hexdigest()
    for candidate in sorted(native_root.glob("*.png")):
        try:
            if candidate.is_symlink() or not candidate.is_file() or candidate.stat().st_mtime < started_at:
                continue
            if hashlib.sha256(candidate.read_bytes()).hexdigest() != digest:
                continue
            with Image.open(candidate) as generated:
                if generated.format != "PNG":
                    continue
                generated.verify()
            return {
                "proof_mode": "current-thread-generated-artifact",
                "thread_id": thread_id,
                "native_generated_path": str(candidate.resolve()),
                "native_generated_sha256": digest,
                "native_generated_mtime": candidate.stat().st_mtime,
                "run_started_at": started_at,
            }
        except (OSError, ValueError):
            continue
    return {}


def _terminate_worker(process: subprocess.Popen[str]) -> None:
    """Stop only the process group created by this invocation."""
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait(timeout=5)


def _local_file(value: Any, directory: Path, label: str) -> Path:
    if not isinstance(value, str) or not value:
        raise CodexGenerationError(f"Codex response is missing {label}.")
    candidate = Path(value).expanduser()
    candidate = candidate if candidate.is_absolute() else directory / candidate
    try:
        candidate = candidate.resolve(strict=True)
    except OSError as error:
        raise CodexGenerationError(f"Codex {label} does not exist: {value}") from error
    if directory not in candidate.parents or not candidate.is_file():
        raise CodexGenerationError(f"Codex {label} must be a regular file inside {directory}.")
    return candidate


def run_codex(source_path: Path, output_dir: Path, job: dict, timeout: int = 900) -> dict:
    """Generate an image/model with the installed Codex CLI and validate outputs.

    ``job`` contains ``prompt`` (string) and ``schema`` (JSON Schema object).
    The structured response must contain ``generated_image_path`` and ``model``
    (an object, or a path to a JSON object inside the output directory).
    Optional ``visual_review`` and other response fields are preserved.

    Returns the response with an absolute image path and ``codex_provenance``.
    A timeout or failed worker raises ``CodexGenerationError``; no older response
    file is accepted as a successful result.
    """
    executable = shutil.which("codex")
    if not executable:
        raise CodexGenerationError("Codex CLI is not installed or is not on PATH.")
    source_path = Path(source_path).expanduser().resolve(strict=True)
    if not source_path.is_file():
        raise ValueError("source_path must refer to an image file.")
    if not isinstance(job.get("prompt"), str) or not job["prompt"].strip():
        raise ValueError("job.prompt must contain the generation instructions.")
    if not isinstance(job.get("schema"), dict):
        raise ValueError("job.schema must be a JSON Schema object.")
    if not isinstance(timeout, int) or timeout < 1:
        raise ValueError("timeout must be a positive number of seconds.")
    output_dir = Path(output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    prompt_path = output_dir / "generation-prompt.txt"
    schema_path = output_dir / "response-schema.json"
    response_path = output_dir / "codex-response.json"
    events_path = output_dir / "events.jsonl"
    stderr_path = output_dir / "stderr.log"
    prompt_path.write_text(job["prompt"], encoding="utf-8")
    schema_path.write_text(json.dumps(job["schema"], indent=2) + "\n", encoding="utf-8")
    # A failed second invocation must not accidentally consume the first result.
    response_path.unlink(missing_ok=True)
    command = [executable, "exec", "--ephemeral", "--sandbox", "workspace-write",
               "--skip-git-repo-check", "--json", "--image", str(source_path),
               "--output-schema", str(schema_path), "-o", str(response_path), "-"]
    evidence: list[dict[str, str]] = []
    events: queue.Queue[tuple[str, str | None]] = queue.Queue()
    started = time.monotonic()
    started_at = time.time()
    thread_id: str | None = None
    process: subprocess.Popen[str] | None = None
    readers: list[threading.Thread] = []

    def read_stream(stream, name: str) -> None:
        try:
            for line in stream:
                events.put((name, line))
        finally:
            events.put((name, None))

    try:
        with prompt_path.open(encoding="utf-8") as prompt, events_path.open("w", encoding="utf-8") as log, stderr_path.open("w", encoding="utf-8") as errors:
            # The logs are local diagnostic artifacts, not console dumps.
            os.chmod(events_path, 0o600)
            os.chmod(stderr_path, 0o600)
            process = subprocess.Popen(command, cwd=output_dir, stdin=prompt,
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                       text=True, encoding="utf-8", errors="replace",
                                       start_new_session=True, bufsize=1)
            for name, stream in (("stdout", process.stdout), ("stderr", process.stderr)):
                reader = threading.Thread(target=read_stream, args=(stream, name), daemon=True)
                reader.start()
                readers.append(reader)
            closed: set[str] = set()
            reported_generation = False
            while len(closed) < 2 or process.poll() is None:
                if time.monotonic() - started > timeout:
                    raise CodexGenerationError(f"Codex generation timed out after {timeout}s; see {stderr_path}.")
                try:
                    stream_name, line = events.get(timeout=.25)
                except queue.Empty:
                    continue
                if line is None:
                    closed.add(stream_name)
                    continue
                if stream_name == "stderr":
                    errors.write(str(_safe_log(line)))
                    errors.flush()
                    continue
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    log.write(json.dumps({"type": "unparsed_output", "text": _safe_log(line.rstrip())}) + "\n")
                    log.flush()
                    continue
                if isinstance(event, dict):
                    if event.get("type") == "thread.started" and isinstance(event.get("thread_id"), str):
                        thread_id = event["thread_id"]
                    new_evidence = _imagegen_evidence(event)
                    evidence.extend(new_evidence)
                    if new_evidence and not reported_generation:
                        print("Codex: imagegen tool call observed.", flush=True)
                        reported_generation = True
                    if event.get("type") in {"turn.started", "turn.completed", "turn.failed"}:
                        print("Codex: " + event["type"] + ".", flush=True)
                log.write(json.dumps(_safe_log(event), ensure_ascii=False) + "\n")
                log.flush()
            returncode = process.wait()
        if returncode:
            raise CodexGenerationError(f"Codex exited with status {returncode}; see {stderr_path} and {events_path}.")
        if not response_path.is_file():
            raise CodexGenerationError(f"Codex did not save its structured response; see {events_path}.")
        try:
            response = json.loads(response_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise CodexGenerationError(f"Codex response is not valid JSON: {response_path}") from error
        if not isinstance(response, dict):
            raise CodexGenerationError("Codex response must be a JSON object.")
        image_path = _local_file(response.get("generated_image_path"), output_dir, "generated_image_path")
        try:
            with Image.open(image_path) as image:
                if image.format != "PNG" or min(image.size) < 1:
                    raise ValueError("Expected a nonempty PNG.")
                image.verify()
        except (OSError, ValueError) as error:
            raise CodexGenerationError(f"Codex output is not a valid PNG: {image_path}") from error
        model = response.get("model")
        model_file_evidence = {}
        if isinstance(model, str):
            model_path = _local_file(model, output_dir, "model")
            try:
                model_bytes = model_path.read_bytes()
                model = json.loads(model_bytes)
            except (OSError, json.JSONDecodeError) as error:
                raise CodexGenerationError(f"Codex model is not valid JSON: {model_path}") from error
            model_file_evidence = {"reviewed_model_path": str(model_path),
                                   "reviewed_model_sha256": hashlib.sha256(model_bytes).hexdigest()}
        if not isinstance(model, dict) or not model:
            raise CodexGenerationError("Codex must return a nonempty reconstruction model object.")
        response["generated_image_path"] = str(image_path)
        response["model"] = model
        artifact_evidence = _native_imagegen_artifact(image_path, thread_id, started_at)
        response["codex_provenance"] = {
            "backend": "codex-exec",
            **model_file_evidence,
            "observed_builtin_imagegen_call": bool(evidence),
            "imagegen_evidence": evidence,
            "verified_builtin_imagegen_artifact": bool(artifact_evidence),
            "native_artifact_evidence": artifact_evidence,
            "thread_id": thread_id,
            "run_started_at": started_at,
            "evidence_note": "Actual tool events only; absent evidence can mean this CLI omitted nested tool events.",
            "events_path": str(events_path),
            "response_path": str(response_path),
            "elapsed_seconds": round(time.monotonic() - started, 3),
        }
        return response
    except BaseException:
        if process is not None:
            _terminate_worker(process)
        raise
    finally:
        for reader in readers:
            reader.join(timeout=1)
        if process is not None:
            for stream in (process.stdout, process.stderr):
                if stream is not None:
                    stream.close()
