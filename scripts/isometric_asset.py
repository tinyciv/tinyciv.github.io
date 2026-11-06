#!/usr/bin/env python3
"""Convert a source sprite using Codex + built-in imagegen, then audit the pixels.

Requires Python 3.9+, Pillow, and an authenticated Codex CLI with imagegen.
No API key or model override is required. Run --help for examples.

Generation is an estimate, not a recovery of unseen geometry. Imagegen proposes
the view; Codex describes its structural/material polygons; one deterministic
orthographic renderer supplies the final pixel sprite and enforceable checks.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import html
import json
from pathlib import Path
import shutil
import sys

from PIL import Image

from isometric_codex import run_codex
from isometric_geometry import render_model, source_palette, validate_output


def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def footprint_arg(text):
    try:
        width, depth = (int(x) for x in text.lower().split("x"))
        if not (1 <= width <= 16 and 1 <= depth <= 16):
            raise ValueError
        return [width, depth]
    except ValueError as error:
        raise argparse.ArgumentTypeError("Use a whole-cell footprint, e.g. 1x1 or 2x3 (maximum 16x16).") from error


def object_schema(properties):
    return {"type": "object", "properties": properties, "required": list(properties), "additionalProperties": False}


def array_schema(item, minimum=None, maximum=None):
    result = {"type": "array", "items": item}
    if minimum is not None:
        result["minItems"] = minimum
    if maximum is not None:
        result["maxItems"] = maximum
    return result


def response_schema():
    text = {"type": "string"}
    return object_schema({
        "generated_image_path": text,
        # Return the reviewed file, not a second transcription of the geometry.
        # A face-size cap in the old response schema caused a 14-vertex outline
        # to lose two corners even though the worker's saved model was correct.
        "model": {"type": "string", "description": "Local path to the complete reviewed-model.json inside the output directory."},
        "visual_review": object_schema({
            "preserves_identity": {"type": "boolean"},
            "consistent_view": {"type": "boolean"},
            "issues": array_schema(text),
        }),
    })


def make_prompt(source, reference, output, palette, footprint, buffer_px, description):
    colors = ", ".join("#%02x%02x%02x" % tuple(c) for c in palette)
    return f"""Reconstruct the supplied visual asset from a new isometric viewpoint.
This is an actual generation task: you MUST use the built-in imagegen tool, inspect
its result, save its generated PNG here, and describe a renderable model using the
contract below. Change the viewpoint while preserving the source's visual identity.

Input image (identity and palette authority): {source}
Nearest-neighbor enlarged reference: {reference}
Output directory (all deliverables): {output}
Optional asset context: {description or 'Use the source image as the reference.'}
Footprint: {footprint[0]} by {footprint[1]} logical grid cells.
Logical resolution: 32x32 pixels per cell; ground diamond is 32x16 in a 2:1 view.
Exact allowed visible RGB palette: {colors}
Required ground-space inset on EVERY side: {buffer_px}/32 cells.

1. Inspect the source and enlarged reference before editing. Record visible evidence:
   silhouette, proportions, component relationships, openings, surface continuity,
   material appearance, and identifying color regions. Distinguish shape boundaries
   from lighting, markings, and pixel-art simplification. A color change alone is
   not evidence of a separate surface or a change in orientation.
   Do not assume a standard structure, component layout, material, or height from
   the asset's category. Preserve the complexity supported by the image. Infer only
   the hidden form necessary to explain a coherent new view, using the simplest
   continuation consistent with that evidence. Record uncertain choices explicitly.
2. Use image_gen__imagegen (discover via functions.exec/ALL_TOOLS if necessary).
   Input reference is the enlarged source image. Request genuine transparency.
   Generate ONE isolated 2:1 orthographic reconstruction of the same asset. The camera
   looks from +X,+Y,+Z; it does not prescribe the number or orientation of surfaces.
   World verticals remain vertical, and the two ground axes project to slopes +1/2
   and -1/2. Other edges follow their own 3D directions under this same projection.
   Parallel world edges stay parallel; scale does not change with distance.
   Preserve the source's forms, relative proportions, surface continuity, and palette.
   Keep connected color regions readable at 32 pixels/cell without antialiasing.
   Do not introduce unsupported parts, surface breaks, ornamentation, or material
   changes. Do not remove observed features merely to simplify the reconstruction.
   Add no backdrop, detached shadow, presentation labels, border, or UI.
   Carry these source-first principles into the imagegen prompt. Do not replace them
   with a guessed construction recipe for a particular kind of object.
   Use transparent_background=true; inspect the generated image before continuing.
   Save/copy the actual generated image to imagegen-proposal.png in the output dir.
   Do not print base64 in the response or replace the generated image with code art.
3. Build the model from the original evidence, using the generated proposal to help
   interpret the new view. The source remains authoritative: discard additions or
   shape changes introduced by the proposal when the source does not support them.
   Use structural surfaces only where needed to represent the supported form. Preserve
   smooth or continuous regions; polygon tessellation must not introduce a faceted
   visual style. Do not reduce complex source forms to a generic primitive either.
   Keep appearance separate from physical shape. Color or shading regions can be
   coplanar overlays on an existing surface; they must not create thickness, creases,
   offsets, or new surface orientations. Use only regions needed for source fidelity
   at native scale, and avoid artificial contrast along tessellation boundaries.
   The final renderer uses solid palette-colored polygons without bitmap textures.
   Treat that as a representation constraint, not evidence of additional physical
   surfaces. Model real structural edges through the shared camera; appearance
   boundaries need not be classified as structural edges.
4. Save the complete model to reviewed-model.json inside the output directory.
   Its vertices field is a list of {{id, position:[x,y,z]}}. Its faces field is a
   list of {{id, vertices:[vertex IDs in boundary order], color:'#RRGGBB', role}}.
   assumptions and source_features are lists of strings. Return this file's local
   path in the final response's model field; do not retranscribe the geometry.
   Preserve every boundary vertex. Never truncate a face to fit a response limit.
   Geometry is measured in grid cells, origin at footprint top-left on the ground.
   Bounds of ALL vertices (including every projecting component) must be centered EXACTLY at
   ({footprint[0]/2}, {footprint[1]/2}) in XY, and inside the inset footprint.
   Fit by placement and uniform scale; do not impose symmetry or change relative
   proportions to fill the available cells.
   Ground is z=0, heights z>=0. Derive height and relative dimensions from source
   evidence; there is no default height or proportion for a one-cell asset.
   Camera projection: screen_x=16*(x-y), screen_y=8*(x+y)-16*z.
   Camera looks from +X,+Y,+Z. Use shared vertex IDs at structural joints.
   Faces are ordered, convex, coplanar polygons with >=3 noncollinear vertices.
   Planar appearance polygons may overlay an existing surface at the SAME
   exact plane (later faces win coplanar depth ties); do NOT offset them with
   epsilon geometry, which can break planarity/centering. Subdivide concave regions
   without changing their visible form. Every vertex must be used. No zero-area faces.
   Use each face's role to distinguish structural surfaces from appearance overlays.
   Every face color must be one of the exact palette hex values above; no new RGBs.
   Model schema_version=1, cell_size=32, footprint={json.dumps(footprint)},
   buffer_px={buffer_px}. source_features must contain observations from the source;
   assumptions must separately identify inferred hidden form and uncertainty.
5. Render the actual saved reviewed-model.json using the parent converter:
   import normalize_model from {Path(__file__).resolve()} and render_model,
   validate_output from {Path(__file__).resolve().parent / 'isometric_geometry.py'}.
   Load the saved JSON, normalize it, render it with the exact source palette,
   and validate that render. Inspect the resulting PNG, not a separate preview
   renderer. After any geometry change, save and repeat this exact review.
   Review the result at native resolution against the original. Check silhouette,
   proportions, component relationships, surface continuity, and identifying colors.
   Explicitly look for unsupported physical surfaces and shading that falsely reads
   as new geometry. Revise those before returning. visual_review must distinguish
   faithful reconstruction from merely consistent projection and report remaining
   issues. Hidden form is an estimate; mathematical checks cannot establish fidelity
   to unseen geometry. The parent script separately validates the rendering contract.

Use the installed/default Codex model and existing tool authentication. Complete
this one asset in this worker; do not spawn or delegate to other agents. Do not
install dependencies, call a separate image API, edit production assets, modify
the converter, or change unrelated files. Do not ask for routine confirmation.
Your final response must be ONLY the requested JSON object.
"""


def normalize_model(model):
    model = dict(model)
    if isinstance(model.get("vertices"), list):
        rows = model["vertices"]
        ids = [row["id"] for row in rows]
        if len(set(ids)) != len(ids):
            raise ValueError("Duplicate vertex IDs in the reconstruction.")
        model["vertices"] = {row["id"]: row["position"] for row in rows}
    return model


def data_uri(path, mime="image/png"):
    return f"data:{mime};base64," + base64.b64encode(Path(path).read_bytes()).decode("ascii")


def make_review(output, source, proposal, model, metadata, report):
    """Self-contained native-size, footprint and neighboring-building review."""
    font_path = Path(__file__).resolve().parents[1] / "public/assets/fonts/pixel-operator/PixelOperator.ttf"
    font = f"@font-face{{font-family:Pixel;src:url('{data_uri(font_path, 'font/ttf')}')}}" if font_path.exists() else ""
    rows = "".join(f"<li class={'pass' if row['passed'] else 'fail'}>{'✓' if row['passed'] else '✗'} {html.escape(row['name'])}</li>" for row in report["checks"])
    assumptions = "".join(f"<li>{html.escape(str(a))}</li>" for a in model.get("assumptions", []))
    payload = {"model": model, "metadata": metadata, "sprite": data_uri(output / "isometric.png")}
    script_data = json.dumps(payload).replace("<", "\\u003c")
    page = """<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Isometric asset conversion</title><style>__FONT__
*{box-sizing:border-box}body{margin:0;background:#132226;color:#efe1bd;font:20px/1.25 Pixel,monospace}main{max-width:1160px;margin:auto;padding:28px}h1{font-size:36px;margin:0 0 8px}h2{font-size:25px;margin:0 0 14px}p{color:#c9c8af}section{margin:24px 0}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}article{border-top:1px solid #8e7848;padding-top:16px}figure{margin:0;height:230px;display:flex;align-items:center;justify-content:center;background:repeating-conic-gradient(#21363a 0% 25%,#263d40 0% 50%) 50%/20px 20px}img{object-fit:contain;image-rendering:pixelated;max-width:100%;max-height:100%}.original{width:192px;height:192px}.final{width:224px;height:224px}figcaption{margin-top:8px;color:#b8c8b8}.native{min-height:72px;display:flex;align-items:center;gap:24px}.native img{max-width:none;max-height:none}.swatch{display:inline-block;width:26px;height:26px;border:1px solid #a58b58;margin:0 4px 4px 0}canvas{display:block;width:100%;height:auto;image-rendering:pixelated;background:#243832}button{font:inherit;border:1px solid #ad8c51;background:#14292c;color:#eed7a5;padding:7px 13px;margin-bottom:10px;cursor:pointer}.checks{columns:2;padding-left:22px}.checks li{break-inside:avoid;margin:5px 0}.pass{color:#b7d897}.fail{color:#ff9c81}details{margin-top:22px}summary{cursor:pointer}.note{font-size:17px;color:#aebfb3}.foot{font-size:16px;color:#a9b8ae}@media(max-width:700px){main{padding:18px}.cards{grid-template-columns:1fr}figure{height:200px}.checks{columns:1}}
</style><main><h1>Isometric asset conversion</h1><p>32-pixel cells · 2:1 orthographic projection · original palette</p>
<section class="cards"><article><h2>Original</h2><figure><img class="original" src="__SOURCE__" alt="Original source sprite enlarged with nearest-neighbor sampling"></figure><figcaption>Palette and identity reference</figcaption></article>
<article><h2>Imagegen estimate</h2><figure><img src="__PROPOSAL__" alt="Generated estimate of the building from the new view"></figure><figcaption>Visual proposal; hidden surfaces are inferred</figcaption></article>
<article><h2>Validated sprite</h2><figure><img class="final" src="__FINAL__" alt="Final isometric sprite"></figure><figcaption>__DIMENSIONS__ pixels · transparent PNG</figcaption></article></section>
<section><h2>Native pixels</h2><div class="native"><img src="__SOURCE__" alt="Original at native size"><span>→</span><img src="__FINAL__" alt="Final at native size"></div><div>__PALETTE__</div></section>
<section><h2>Footprint and neighboring cells</h2><button id="grid" aria-pressed="true">Hide grid</button><canvas id="stage" width="960" height="380" aria-label="Building repeated on neighboring isometric cells with footprint overlays"></canvas><p class="note">Gold: allocated cells. Green: allowed ground bounds after the buffer. White dot: fixed ground anchor. Elevated roofs can visually occlude a neighbor without occupying its ground space.</p></section>
<section><h2>Checks</h2><ul class="checks">__CHECKS__</ul><p class="note">Every final straight edge comes from a polygon projected by the same camera. The source and generated view guide the reconstruction; hidden geometry remains an estimate.</p></section>
<details><summary>Reconstruction assumptions</summary><ul>__ASSUMPTIONS__</ul></details>
<p class="foot">The generated proposal, inferred model, pixel sprite, anchor metadata, checks and generation log are saved alongside this review.</p>
</main><script>const data=__DATA__,im=new Image();im.src=data.sprite;const c=document.querySelector('canvas'),g=c.getContext('2d');let grid=true;
const m=data.metadata,w=data.model.footprint[0],d=data.model.footprint[1],b=data.model.buffer_px/32;
function proj(x,y,z=0){return [16*(x-y),8*(x+y)-16*z]}
function poly(points,color){g.beginPath();points.forEach((p,i)=>i?g.lineTo(...p):g.moveTo(...p));g.closePath();g.strokeStyle=color;g.lineWidth=.5;g.stroke()}
function draw(){g.clearRect(0,0,c.width,c.height);g.imageSmoothingEnabled=false;
const positions=[[-w,-d],[0,-d],[w,-d],[-w,0],[0,0],[w,0],[-w,d],[0,d],[w,d]].sort((a,b)=>a[0]+a[1]-b[0]-b[1]);
const geometry=[...Object.values(data.model.vertices),[0,0,0],[w,0,0],[w,d,0],[0,d,0]],points=positions.flatMap(([x,y])=>geometry.map(([a,b,z])=>proj(x+a,y+b,z))),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),left=Math.min(...xs),right=Math.max(...xs),top=Math.min(...ys),bottom=Math.max(...ys),scale=Math.min(10,(c.width-50)/(right-left),(c.height-50)/(bottom-top));
g.save();g.translate(c.width/2-(left+right)*scale/2,c.height/2-(top+bottom)*scale/2);g.scale(scale,scale);
for(const [x,y] of positions){const q=proj(x,y);g.save();g.translate(...q);if(grid){poly([[0,0],[w,0],[w,d],[0,d]].map(p=>proj(...p)),'#cfab68');poly([[b,b],[w-b,b],[w-b,d-b],[b,d-b]].map(p=>proj(...p)),'#7cba91')}
const anchor=m.ground_anchor,center=proj(w/2,d/2);g.drawImage(im,center[0]-anchor[0],center[1]-anchor[1]);if(grid){g.fillStyle='#fff0cb';g.fillRect(center[0]-.5,center[1]-.5,1,1)}g.restore()}g.restore()}
document.querySelector('#grid').onclick=e=>{grid=!grid;e.target.textContent=grid?'Hide grid':'Show grid';e.target.setAttribute('aria-pressed',String(grid));draw()};im.onload=draw;if(im.complete)draw();</script></html>"""
    colors = source_palette(source)
    swatches = "".join(f'<span class="swatch" style="background:rgb{tuple(color)}" title="#{color[0]:02x}{color[1]:02x}{color[2]:02x}"></span>' for color in colors)
    with Image.open(output / "isometric.png") as final_image:
        image_size = final_image.size
    replacements = {
        "__FONT__": font, "__SOURCE__": data_uri(source), "__PROPOSAL__": data_uri(proposal),
        "__FINAL__": data_uri(output / "isometric.png"), "__DIMENSIONS__": f"{image_size[0]} × {image_size[1]}",
        "__PALETTE__": swatches, "__CHECKS__": rows, "__ASSUMPTIONS__": assumptions,
        "__DATA__": script_data,
    }
    for key, value in replacements.items():
        page = page.replace(key, value)
    (output / "review.html").write_text(page, encoding="utf-8")


def parser():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""Examples:
  python3 scripts/isometric_asset.py tent.png --output scratch/tent-iso
  python3 scripts/isometric_asset.py castle.png --footprint 2x2 --output scratch/castle-iso
  python3 scripts/isometric_asset.py tent.png --output scratch/tent-replay \\
    --reuse-proposal scratch/tent-iso/proposal.json

The default invokes Codex with built-in imagegen. --prepare-only writes the job
without making a generation call. --reuse-proposal re-renders a previously
generated estimate with the same deterministic checks, without a model call.
Use --atlas-rect X,Y,W,H when the original image is an atlas. Outputs are written
to a new directory; existing final assets are never overwritten.
""")
    p.add_argument("source", type=Path)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--footprint", type=footprint_arg, default=[1, 1])
    p.add_argument("--buffer", type=float, default=2, help="Inset in 32px cell coordinates (default: 2px).")
    p.add_argument("--atlas-rect", help="Lossless source crop: X,Y,W,H")
    p.add_argument("--description", default="")
    p.add_argument("--timeout", type=int, default=900)
    p.add_argument("--prepare-only", action="store_true")
    p.add_argument("--reuse-proposal", type=Path)
    return p


def main(argv=None):
    args = parser().parse_args(argv)
    source = args.source.expanduser().resolve(strict=True)
    output = args.output.expanduser().resolve()
    if not (2 <= args.buffer < 16 * min(args.footprint)):
        raise ValueError("Buffer must be at least 2 pixels and leave room inside the footprint.")
    if output.exists() and any(output.iterdir()):
        raise ValueError("Output directory must be empty; choose a new directory to preserve previous assets.")
    output.mkdir(parents=True, exist_ok=True)
    with Image.open(source) as original:
        image = original.convert("RGBA")
    if args.atlas_rect:
        try:
            x, y, width, height = [int(v) for v in args.atlas_rect.split(",")]
            if x < 0 or y < 0 or width < 1 or height < 1 or x + width > image.width or y + height > image.height:
                raise ValueError
        except ValueError as error:
            raise ValueError("Atlas rectangle must be X,Y,W,H fully within the source image.") from error
        image = image.crop((x, y, x + width, y + height))
    input_path = output / "source.png"
    image.save(input_path)
    palette = source_palette(input_path)
    if not palette:
        raise ValueError("Source sprite has no visible pixels.")
    if len(palette) > 256:
        raise ValueError("Source has over 256 visible colors; supply the original pixel-art asset without antialiasing.")
    factor = max(1, min(32, 384 // max(image.size)))
    reference = output / "source-reference.png"
    image.resize((image.width * factor, image.height * factor), Image.Resampling.NEAREST).save(reference)
    write_json(output / "palette.json", {"source": str(source), "source_sha256": sha256(source), "cropped_source_sha256": sha256(input_path), "colors": palette})
    prompt = make_prompt(input_path, reference, output, palette, args.footprint, args.buffer, args.description)
    job = {"prompt": prompt, "schema": response_schema()}
    write_json(output / "job.json", job)
    if args.prepare_only:
        print(f"Prepared {output / 'job.json'} ({len(palette)} source colors).")
        return 0

    if args.reuse_proposal:
        old_path = args.reuse_proposal.expanduser().resolve(strict=True)
        proposal = json.loads(old_path.read_text(encoding="utf-8"))
        old_manifest = old_path.parent / "palette.json"
        if not old_manifest.exists() or json.loads(old_manifest.read_text())["cropped_source_sha256"] != sha256(input_path):
            raise ValueError("Reused proposal does not belong to this source crop.")
        old_image = Path(proposal["generated_image_path"])
        old_image = (old_image if old_image.is_absolute() else old_path.parent / old_image).resolve(strict=True)
        if not old_image.is_relative_to(old_path.parent.resolve()):
            raise ValueError("Reused image must be inside its original proposal directory.")
        old_metadata = old_path.parent / "metadata.json"
        old_model = old_path.parent / "model.json"
        if not old_metadata.is_file() or not old_model.is_file():
            raise ValueError("Reused proposal needs its completed metadata and model files.")
        prior = json.loads(old_metadata.read_text(encoding="utf-8"))
        if prior.get("generated_proposal_sha256") != sha256(old_image):
            raise ValueError("Reused generated image has changed since validation.")
        if prior.get("model_sha256") != sha256(old_model) or normalize_model(proposal["model"]) != json.loads(old_model.read_text(encoding="utf-8")):
            raise ValueError("Reused reconstruction has changed since validation.")
        shutil.copyfile(old_image, output / "imagegen-proposal.png")
        proposal["generated_image_path"] = str(output / "imagegen-proposal.png")
        # Keep the original generation evidence with the portable replay bundle.
        for name in ("generation-prompt.txt", "imagegen-prompt.txt", "response-schema.json", "events.jsonl", "stderr.log", "codex-response.json", "native-artifact-verification.json"):
            recorded = old_path.parent / name
            if recorded.is_file():
                shutil.copyfile(recorded, output / name)
        backend = {"mode": "reused-codex-imagegen-proposal", "proposal": str(old_path),
                   "original_generation": prior.get("generation", {}), "prompt": "generation-prompt.txt"}
    else:
        print(f"Generating with Codex/imagegen; source has {len(palette)} colors. Logs: {output}", flush=True)
        proposal = run_codex(reference, output, job, timeout=args.timeout)
        backend = {"mode": "codex-exec-built-in-imagegen", "events": "events.jsonl", "prompt": "generation-prompt.txt"}

    write_json(output / "proposal.json", proposal)
    provenance = proposal.get("codex_provenance", {})
    if not (provenance.get("observed_builtin_imagegen_call") or provenance.get("verified_builtin_imagegen_artifact")):
        raise ValueError("No actual imagegen event or matching current-thread native artifact was verified. Refusing to label an unverified image as imagegen output; inspect the generation log.")
    generated = Path(proposal["generated_image_path"]).resolve(strict=True)
    if not generated.is_relative_to(output):
        raise ValueError("Generated image must be saved inside the output directory.")
    with Image.open(generated) as candidate:
        if candidate.format != "PNG":
            raise ValueError("Generated proposal must be a PNG.")
        candidate.verify()
    model = normalize_model(proposal["model"])
    if model["footprint"] != args.footprint or model["cell_size"] != 32 or model["buffer_px"] != args.buffer:
        raise ValueError("Codex changed the requested footprint, resolution, or buffer.")
    if not proposal["visual_review"]["preserves_identity"] or not proposal["visual_review"]["consistent_view"]:
        raise ValueError("Visual reconstruction review failed; inspect proposal.json and revise the estimate.")
    write_json(output / "model.json", model)
    sprite, metadata = render_model(model, palette)
    report = validate_output(sprite, model, palette, metadata)
    report["visual_review"] = proposal["visual_review"]
    write_json(output / "validation.json", report)
    if not report["passed"]:
        names = [row["name"] for row in report["checks"] if not row["passed"]]
        raise ValueError("Asset failed validation: " + ", ".join(names))
    sprite.save(output / "isometric.png")
    # Audit the encoded deliverable as well, so file mode/alpha mistakes cannot slip through.
    with Image.open(output / "isometric.png") as saved:
        encoded_report = validate_output(saved.convert("RGBA"), model, palette, metadata)
    if not encoded_report["passed"]:
        raise ValueError("Encoded PNG failed pixel validation.")
    sprite.resize((sprite.width * 12, sprite.height * 12), Image.Resampling.NEAREST).save(output / "isometric-12x.png")
    metadata.update({"source": str(source), "source_sha256": sha256(source), "source_crop_sha256": sha256(input_path),
                     "generated_proposal_sha256": sha256(generated), "model_sha256": sha256(output / "model.json"),
                     "sprite_sha256": sha256(output / "isometric.png"), "generation": backend,
                     "hidden_surfaces": "Estimated from the original and imagegen proposal; not ground truth."})
    write_json(output / "metadata.json", metadata)
    make_review(output, input_path, generated, model, metadata, report)
    print(f"PASS: {len(report['checks'])} checks; {sprite.width}x{sprite.height}px; {len(palette)} allowed colors.")
    print(f"Sprite: {output / 'isometric.png'}\nReview: {output / 'review.html'}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, RuntimeError, OSError, KeyError) as error:
        print(f"Conversion failed: {error}", file=sys.stderr)
        raise SystemExit(1)
