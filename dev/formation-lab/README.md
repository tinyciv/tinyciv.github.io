# Formation III prototype

Build with `node scripts/build-formation-lab.mjs`, then open `scratch/2026-11-03-formation/index.html`. The HTML embeds its JavaScript, native Puny World sprites, and Pixel Operator font, so it works without a server. It does not read or change game saves, and it does not add a formation to the live game.

## Controls

- Click traversable ground to move; **March across** gives a useful route for each map.
- **3** or the Formation button switches between close formation and loose movement.
- Hold **A / D** to shift left/right relative to the formation’s facing without turning. Releasing the keys stops movement.
- **Q / E** rotate 90 degrees; keyboard repeat never queues extra rotations. **Space** pauses. The speed control switches between 1× and 2×.
- Wheel or use **+ / −** to zoom; **Fit** restores the full map.
- Choose 6, 12, or 24 soldiers and open field, narrow gate, winding waterway, or city streets.
- **Front / Flank / Rear** spawn an equal-sized enemy probe relative to the army's current facing. Reset restores health.
- Three selectable SVG icon treatments are included for review; the compact ranks icon is the default.

## Simulation

The Leader is the center of a stable, symmetric rectangle. Normal speed is 3.4 tiles/s; formation speed is 2.38 tiles/s (70%). Soldiers have no friendly collision solver in this prototype. Individual motion remains terrain checked and is limited to 2.975 tiles/s (125% of formation speed), including wheeling and slot recovery. Outer ranks limit turn rate; a badly stretched formation slows its center until it closes up.

Look-ahead slot checks compress the group into one column before narrow terrain. Column positions follow the same smoothed path, with soldiers both ahead of and behind the Leader. Each soldier can take a short A* detour while changing layout. The group reopens once the rectangular footprint fits again. Terrain checks use circular bodies and swept segments, so interpolation cannot pass through walls or cut blocked corners. At rest, exact fixed targets remove milling.

The frontal sector is 120 degrees centered on the army's facing. A formed soldier deals twice the normal damage to targets in that sector and has twice the defense against attacks arriving from it (half incoming damage). Flank and rear attacks retain normal damage. Loose soldiers can pursue nearby enemies; formed soldiers hold their slots and strike targets in reach. Front and flank demo totals differ by engagement counts as well as the per-hit multiplier.

This is a focused prototype: there is no recruitment, research, save system, or live-game integration. Terrain compression, combat numbers, and the 120-degree sector are explicitly exposed choices for review.

## Checks

`node scripts/check-formation-lab.mjs` launches isolated Chrome and records checks and screenshots beside the HTML. It covers every terrain/army combination, arrival and reopening, swept terrain clearance, idle drift, exact marching speed, centered wheeling and catch-up limits, keyboard strafing with fixed facing and ranks, release/blur stopping, changed orders mid-corridor, actual front/flank combat, the toggle, click orders, icon alternatives, and compact layout. CPU and navigation timings are captured in `checks.json`.
