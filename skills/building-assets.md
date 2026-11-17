# Matching the existing building set

Use this production workflow when a building must match the existing Puny World / Medieval World art. Read `visuals.md` for the general asset workflow. Broad exploration of realism or resolution belongs to choosing a new art direction; when continuing the established set, keep those properties fixed and explore architecture instead.

## Reference kit before generation

- Choose a small set of approved native sprites appropriate to the proposed building. Record exact source rectangles, native dimensions, faction recoloring, and ground anchors.
- Separate original native references from generated art or screenshots. An approved high-resolution building may be useful for scene context without being a reliable palette or pixel-grid source.
- Extract exact material ramps: faction roof, masonry or plaster, timber, recesses, and outlines. Record the purpose of each ramp. A color-count limit does not establish a common palette.
- Measure screen-space construction: visible roof depth, facade height, edge slopes, column/post widths, and openings. Do not invent a universal roof-to-wall ratio or rely only on camera-angle adjectives.

## Design and render

1. Draw a native-grid layout guide with roof planes, facade, entrances, identifying features, and the visible foundation. Keep the elevated, front-aligned projection and vertical posts. Footprint and sprite height are separate measurements.
2. For several candidates, vary footprint, roof arrangement, wings, colonnades, courtyards, and functional landmarks. Hold native pixel density, lighting, palette roles, outlines, and surface-detail density constant.
3. Use imagegen for building generation. Supply the layout guide for geometry and the approved source sprites for material/style. Explain each input's role. Preserve the actual inputs and prompt.
4. Treat the returned image as an appearance proposal. Inspect it, register it to the native grid, and finish at native resolution. Preserve accepted geometry and pixels during local revisions.
5. Constrain final colors by material, preserve readable gaps and connected clusters, and keep wall/post shades coherent along their height. Deliberate one-pixel seams, highlights, and structural edges are allowed when they occur in the references; arbitrary noise and pinholes are not.
6. Record the distinction between AI-generated appearance, source-material reuse, and deterministic geometry/palette corrections. Do not describe a resampled high-resolution image as native output from the generator.

## Review

- Show native size, actual game scale, and integer enlargement with nearest-neighbor sampling.
- Compare beside original houses and larger buildings on the game's terrain, sharing native pixel scale and visible-foundation baseline.
- Use an isolated in-memory game preview for renderer checks; do not alter saves or production art merely to present a candidate.
- Check projection, architectural identity, material treatment, and readability separately. Size, alpha, and palette checks cannot establish aesthetic success.
- Deliver a labelled standalone HTML gallery with final PNGs, metadata, guides, references, and generation provenance. Integration remains a separate selection step.

The [classical temple study](../scratch/2026-11-08-classical-temple-study/guide.md) is a worked example with explicit geometry masks and an exact source palette.
