Forged Citadel HUD art — user-approved design implementation

Generated with the built-in imagegen tool, using the approved final concept as the style reference. Files are copied unchanged from generated outputs; all dynamic text, keys, values, meters and map content belong in code.

minimap-frame.png: 1254x1254 RGBA; transparent center and exterior. Place a circular live map beneath, centered at50% x47.5% of image area with diameter70%; the ring masks the overscan.
hotbar-frame.png: 2126x740 RGBA, transparent opening. Actual alpha bounds x75,y175 through2052,527. Frame main opening approx x215..1910,y360..465, with wing tips above. Straight horizontal rails may be stretched/sliced while preserving end decoration.
panel-frame.png:1586x992 RGBA, quiet charcoal slate center. Source nine-slice around110px at each edge works for border-image fill. Use a small actual border width (8–12px).
action-symbols.png:1254x1254 RGBA,2x2 equal-cell atlas: hammer,stone wall / machete,forbid. Use background-size:200%200% and0/100% positions. At64px cell the visible symbol is roughly50px; no text or glow baked in.
approved-reference.png: unmodified1584x993 final concept. Source regions for resource pictograms and reference samples are documented in source-regions.json; use CSS background clipping, no production text should be taken from it. Action-symbols.png is preferred over reference action crops.

Full prompts and art review: scratch/2026-10-31-hud-implementation/art/. Generated source paths and alpha geometry:manifest.json.

2026-11-01: action-symbols-pixel.png replaces the Build, Fortify, and Clear symbols with the user-approved balanced pixel-art trio (variant1B). Three equal724pxcells; rendered46px. Forbid continues using the original atlas. Source and prompt: scratch/2026-11-01-rounded-controls-and-icons/.

2026-11-01: retinue-actions-pixel.png installs approved pair 2B: rally flag with return arrow for Recall (slot 1), and shield/sword with switch arrows for Toggle Stance (slot 2). Two equal 887px cells, rendered at 40px on desktop and 30px on narrow screens, with centered labels below. Source and prompt: scratch/2026-11-01-rounded-controls-and-icons/.
