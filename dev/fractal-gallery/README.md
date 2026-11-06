# Fractal parameter review

Open `output/fractal-generation-gallery.html` directly in a browser. It contains
25 precomputed production Fractal maps, with native terrain art embedded for
the interactive detail view. No server or network connection is required.

The collection uses one terrain seed and 25 deterministic Latin-hypercube samples
of every landscape parameter. Each control spans its moderate review range, with
independent permutations, so dry, wooded, rocky, and coastal traits are not forced
to move together. Exact settings and their supported ranges are visible in each
map's inspector. Regenerate creates a fresh collection from another seed.

Click a map to pan and zoom through native game terrain, or jump to mountains,
a lake, or the player start. Repeated Mountains clicks cycle through elongated,
compact, small, and large bodies, with actual tile dimensions shown in the view.
Numbered capitals use distinct faction colors, with
matching smaller dots for second cities. Toggle the equator guide to compare
climate patterns. Stars keep favorites in browser storage when available.
Download settings exports the exact Fractal configuration; Import reproduces it.

The build precomputes all overview maps and measurements, so initial review is
instant. Full terrain is generated lazily for a selected sample and retained in
a three-world cache. Runtime regeneration yields between maps and reports its
progress. Percentages refer to dry land; desert excludes beaches; start spacing
uses faction capitals rather than their secondary settlements.

```sh
node scripts/build-fractal-gallery.mjs
node scripts/check-fractal-gallery.mjs
```

The browser check uses isolated Chrome and writes screenshots, checks, and
production sample measurements to `scratch/2026-10-30-fractal-review/`.
