# Tributary and headwater design

The standalone artifact is `output/river-network-design.html`. It embeds the
Puny World atlas and a deterministic, conservative runoff model. It uses three
seeded nested tributary plans to illustrate the proposed channel hierarchy;
the existing game generator is not called or modified.

Channels now vary between asymmetric bends and quieter connectors. Main rivers
have broad lateral sweeps; tributaries use shorter, independently varied bends.
Headwater extensions follow a smooth valley-cost field rather than cardinal
distance bands. The displayed stream ribbons round turns inside the same
receiver cells, keeping their confluences connected.

```sh
node scripts/build-river-network-design.mjs
npx vitest run dev/river-network-design/model.test.ts
node scripts/check-river-network-design.mjs
```

Select a channel to inspect its upstream catchment and discharge equation.
Change rainfall, headwater density or ford spacing; use the walking probe to
test the actual passability mask. The probe uses cardinal BFS to demonstrate
crossing availability. The proposed stream speed penalty and production
navigation integration are described in `design-notes.md`.

The prototype draws diagonal centerline joins between water cells; production
tile rendering must preserve continuous water and the same bank-to-bank
movement rules. No movement cost or JS/WASM integration is claimed here.

Current checks and screenshots are in `scratch/2026-10-31-river-sinuosity/`.
The original study captures remain in `scratch/2026-10-30-river-network-design/`.
