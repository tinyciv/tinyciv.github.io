# Swampy river valley studies

Build with `node scripts/build-swamp-valley-review.mjs`, then open `output/swamp-river-valley-designs-v3.html` directly (the unversioned filename is updated too). The standalone review embeds all artwork, Pixel Operator, four terrain compositions, and the procedural model. It needs no server or network connection.

The designs vary the channel pattern, valley enclosure, grass coverage, and wooded margins. Each uses a 48×32 tile scene with native water/shore/ledge autotiles. The revised river networks use true one-cell-wide, cardinal-connected paths with occasional wider reaches. Revision 3 tightens only 1A Oxbow fen: more frequent bends and five closely spaced side routes leave narrow strips of land between braids, while the other three compositions retain their prior geography. Branches split and rejoin around dry islands, with cutoff oxbows and small pools off the live channel. Broad habitat fields create dense reed beds, sparse damp edges, open meadow, and loose woodland. Plant height and dominant plant type vary by habitat, rather than using uniform coverage along every bank. Trees retain gaps between their crowns.

Choose a design card to inspect it. Grass height and cover controls vary the planting; “Lift tall grass” exposes the underlying waterways. “Another layout” advances that design's seed. Native and game-scale views preserve nearest-neighbor pixels, and Save PNG exports the current scene.

Ground and ordinary trees come from the installed native terrain and vegetation packs. The four marsh PNGs are the previously approved project wetland variants, used here at reduced display scale without editing the source images. All four variants are mixed into the grass pass, grounded at tile (0.5, 15/16), and sorted with trees by their footing.

This is a design study; it does not modify production terrain generation or game assets. Source files live here, the builder lives in `scripts/build-swamp-valley-review.mjs`, and browser screenshots and QA reports live in `scratch/2026-11-04-oxbow-tight-loops/`.
