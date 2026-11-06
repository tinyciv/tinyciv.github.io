#!/usr/bin/env python3
"""Embed the art-resolution experiment as one portable, offline HTML page."""
from pathlib import Path
import argparse
import base64
import hashlib
import json
import mimetypes
import struct


ROOT = Path(__file__).resolve().parents[1]
DIRECTORY = ROOT / "output/art-resolution-study"


def embed_file(path):
    source = ROOT / path
    data = source.read_bytes()
    mime = mimetypes.guess_type(source.name)[0] or "application/octet-stream"
    return data, "data:" + mime + ";base64," + base64.b64encode(data).decode("ascii")


def embed_image(node):
    if not isinstance(node, dict):
        return
    if node.get("path"):
        data, node["dataUrl"] = embed_file(node["path"])
        node["sha256"] = hashlib.sha256(data).hexdigest()
        node["bytes"] = len(data)
        if data[:8] == b"\x89PNG\r\n\x1a\n":
            width, height = struct.unpack(">II", data[16:24])
            for key, actual in (("width", width), ("height", height)):
                if node.get(key) is not None and node[key] != actual:
                    raise ValueError(f"{node['path']}: declared {key} {node[key]} does not match {actual}")
                node[key] = actual
    for key in ("rawPath", "masterPath", "sourcePath"):
        if node.get(key):
            _, node[key.replace("Path", "DataUrl")] = embed_file(node[key])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DIRECTORY / "manifest.json")
    parser.add_argument("--output", type=Path, default=ROOT / "output/btv-art-resolution-study.html")
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text())
    for reference in manifest.get("references", {}).values():
        if isinstance(reference, dict) and reference.get("path"):
            embed_image(reference)
        elif isinstance(reference, dict):
            for source in reference.values():
                embed_image(source)
    for asset in manifest["assets"]:
        embed_image(asset)
        for variant in [*asset["variants"].values(), *asset.get("resolutionOnly", {}).values()]:
            embed_image(variant)
            variant.setdefault("frameWidth", variant["width"])
            variant.setdefault("frameHeight", variant["height"])
            variant.setdefault("frames", 1)
            if not isinstance(variant["frames"], int) or variant["frames"] < 1:
                raise ValueError(f"{asset['id']}: frames must be a positive count")
            if variant["frameWidth"] * variant["frames"] > variant["width"] or variant["frameHeight"] > variant["height"]:
                raise ValueError(f"{asset['id']}: horizontal animation frames exceed the native PNG")
    audit_path = manifest.get("auditPath")
    audit = json.loads((ROOT / audit_path).read_text()) if audit_path and (ROOT / audit_path).exists() else None
    payload = json.dumps({"manifest": manifest, "audit": audit}, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    template = (DIRECTORY / "gallery-template.html").read_text()
    if template.count("__RESOLUTION_DATA__") != 1:
        raise ValueError("Template must contain exactly one __RESOLUTION_DATA__ placeholder")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(template.replace("__RESOLUTION_DATA__", payload))
    print(f"Built {args.output.relative_to(ROOT)} ({args.output.stat().st_size:,} bytes; {len(manifest['assets'])} assets × {len(manifest['options'])} options)")


if __name__ == "__main__":
    main()
