# Open forest world review

`output/open-forest-world-review.html` is an offline review of nine generated
worlds: three seeds, each in Continents, Pangaea and Fractal. It embeds the full
compressed world snapshots and existing Puny/Medieval artwork. Opening a world
does not run generation or access a server.

Open a whole map or a woodland detail, drag to pan, scroll to zoom, and cycle
through dense woodland regions. Trees, tile grids, access markers and settlement
markers can be toggled. Stars remember favorites when browser storage permits;
settings and shortlists can be downloaded as JSON.

The woodland measurements distinguish actual walkable clearings from water and
cliffs. Previews show wooded land share, unwooded land share, and fully wooded
2×2 patches. The inspector adds the share of wooded tiles with a cardinally adjacent,
traversable opening, respecting ridge and stair access.

Build after changing world generation:

```sh
node scripts/build-open-forest-review.mjs
node scripts/check-open-forest-review.mjs
```

Snapshots, generation measurements, browser checks and review screenshots are
kept in `scratch/2026-10-30-open-forests/`. Chrome or another browser supporting
`DecompressionStream` can open the standalone HTML directly from disk.
