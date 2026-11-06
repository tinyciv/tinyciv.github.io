# Rock and outcrop review

Build the self-contained catalog of existing local asset packs:

```sh
node scripts/build-rock-asset-review.mjs
node scripts/check-rock-asset-review.mjs
```

The result is `output/rock-asset-review.html`. Source PNGs are embedded once per
unique byte hash. Cards and the inspector draw exact source rectangles without
editing files or recoloring pixels. The inspector offers integer enlargement,
the full source sheet, coordinates and source metadata. Favorites export JSON.

The three manifests group the inventory by source collection. Their rectangles
are in original image pixels. Full sheets preserve variants and tile pieces that
are easier to review together; object crops provide convenient close-ups.
Website-only previews and duplicate downloaded files are excluded.

Inventory records, checks and screenshots are in
`scratch/2026-10-30-rock-assets/`. This catalog is independent of game generation.
