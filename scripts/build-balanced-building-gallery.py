#!/usr/bin/env python3
"""Build a small, visual-only building gallery with every file embedded."""
from pathlib import Path
import base64
import io
import json
import mimetypes
import struct
import zipfile


ROOT = Path(__file__).resolve().parents[1]
DIRECTORY = ROOT / "output/balanced-building-study"


def embed_image(node):
    if not isinstance(node, dict) or not node.get("path"):
        return
    source = ROOT / node["path"]
    data = source.read_bytes()
    mime = mimetypes.guess_type(source.name)[0] or "application/octet-stream"
    node["dataUrl"] = "data:" + mime + ";base64," + base64.b64encode(data).decode("ascii")
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        width, height = struct.unpack(">II", data[16:24])
        for key, actual in (("width", width), ("height", height)):
            if node.get(key) is not None and node[key] != actual:
                raise ValueError(f"{source.name}: declared {key} does not match PNG")
            node[key] = actual


def zip_bytes(entries):
    """Keep unchanged inputs byte-identical across rebuilds."""
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as package:
        for name in sorted(entries):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            package.writestr(info, entries[name], compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    return archive.getvalue()


def main():
    raw_manifest = json.loads((DIRECTORY / "manifest.json").read_text())
    manifest = json.loads(json.dumps(raw_manifest))
    for reference in manifest.get("references", {}).values():
        if isinstance(reference, dict) and reference.get("path"):
            embed_image(reference)
        elif isinstance(reference, dict):
            for source in reference.values():
                embed_image(source)
    native_entries = {}
    package_manifest = {"title": "Wooden buildings", "assets": []}
    for asset in manifest["assets"]:
        package_asset = {key: value for key, value in asset.items() if key not in ("variants", "sourcePath", "masterPath", "rawPath")}
        package_asset["variants"] = {}
        for option in ("p16", "p32"):
            variant = asset["variants"][option]
            embed_image(variant)
            variant.setdefault("frameWidth", variant["width"])
            variant.setdefault("frameHeight", variant["height"])
            variant.setdefault("frames", 1)
            if variant["frameWidth"] * variant["frames"] > variant["width"] or variant["frameHeight"] > variant["height"]:
                raise ValueError(f"{asset['id']}: frames exceed native PNG")
            archive_path = option + "/" + asset["id"] + ".png"
            native_entries[archive_path] = (ROOT / variant["path"]).read_bytes()
            package_asset["variants"][option] = {key: value for key, value in variant.items() if key != "dataUrl"}
            package_asset["variants"][option]["path"] = archive_path
        package_manifest["assets"].append(package_asset)
    native_entries["manifest.json"] = json.dumps(package_manifest, ensure_ascii=False, indent=2).encode("utf-8")
    archive_bytes = zip_bytes(native_entries)
    archive_output = ROOT / "output/btv-balanced-buildings-native.zip"
    archive_output.write_bytes(archive_bytes)
    archive_url = "data:application/zip;base64," + base64.b64encode(archive_bytes).decode("ascii")
    payload = json.dumps({"manifest": manifest, "archiveDataUrl": archive_url}, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    template = (DIRECTORY / "gallery-template.html").read_text()
    if template.count("__BALANCED_BUILDING_DATA__") != 1:
        raise ValueError("Template needs exactly one __BALANCED_BUILDING_DATA__ placeholder")
    output = ROOT / "output/btv-balanced-buildings.html"
    output.write_text(template.replace("__BALANCED_BUILDING_DATA__", payload))
    full_entries = dict(native_entries)
    for source in raw_manifest["sources"]:
        source_path = ROOT / source["path"]
        archive_path = "sources/" + source_path.name
        if archive_path in full_entries:
            raise ValueError(f"Duplicate source filename: {archive_path}")
        full_entries[archive_path] = source_path.read_bytes()
    for name in ("prompts.json", "README.txt"):
        full_entries[name] = (DIRECTORY / name).read_bytes()
    full_entries["gallery.html"] = output.read_bytes()
    full_output = ROOT / "output/btv-balanced-buildings.zip"
    full_output.write_bytes(zip_bytes(full_entries))
    print(f"Built {output.relative_to(ROOT)} ({output.stat().st_size:,} bytes; {len(manifest['assets'])} sprite pairs)")
    print(f"Built {archive_output.relative_to(ROOT)} ({len(archive_bytes):,} bytes; identical to embedded download)")
    print(f"Built {full_output.relative_to(ROOT)} ({full_output.stat().st_size:,} bytes; {len(full_entries)} files)")


if __name__ == "__main__":
    main()
