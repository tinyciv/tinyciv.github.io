# Fisheries and whaling

`rust/src/sim/fisheries.rs` owns fish stocks, whale resources and vessel components in the game's Bevy World. TypeScript transports geometry, site lifecycle observations, damage and serializable mirrors; it applies native income events and renders generated art.

## Fishing

- Lakes and seas contain shared, invisible fishery districts. Adding docks never creates more stocks. Small lakes split by district boundaries receive a combined stock.
- Each district begins with 160 food-equivalent biomass. Each completed city dock supports one 1×2 fishing vessel. Cities may build multiple docks.
- A trip loads up to 20 food over six seconds, returns physically to its home mooring and unloads for three seconds. Only delivery credits faction food, city delivered-food counters and the rolling city food estimate. A nearly depleted fishery can yield a partial final catch.
- Catch removes biomass from the shared stock. Exactly zero is an absorbing, permanently collapsed state. There is no immigration or respawn that revives a collapsed district.
- Up to eight presentation-only splash markers per district are proportional to stock/capacity. They retain the existing occasional fish-breach animation. No boundary or health bar is drawn.
- Destroyed vessels are replaced after 30 seconds if their port is still operational. Capture, destruction or loss of a friendly city stops the former owner's service and discards its undelivered cargo.

## Recovery model and scientific inspiration

For positive biomass `B` and carrying capacity `K`, recovery follows a Schaefer logistic production model with a weak depensation multiplier:

```
dB/dt = r B (1 - B/K) B/(B + A)
r = 0.065 per game second
A = 0.15 K
```

Once per second, the implementation freezes `B/(B+A)` for that interval and evaluates the corresponding logistic step analytically. This keeps biomass positive and bounded by capacity. Recovery is rapid at moderate stock, slows near carrying capacity and becomes weak near depletion. Harvesting can still remove the last biomass and trigger permanent collapse.

The density-dependent production shape comes from the [FAO description of the Schaefer model](https://www.fao.org/4/a0212e/A0212E14.htm). Reduced recovery at very low stock is inspired by [Allee effects and the Allee-effect zone in northwest Atlantic cod](https://pmc.ncbi.nlm.nih.gov/articles/PMC8807053/). The weak-depensation factor, accelerated game timescale, equal district capacities and permanent local extinction at zero are design choices, not fitted biological predictions or claims that every real fish stock behaves this way.

## Whaling

- Whaling ships search up to 300 water-route tiles from their home mooring; fishing boats retain their 48-tile range.
- **Whaling** follows Sailing in the research tree (60 base science; 180 with the current depth multiplier).
- A **Whaling post** costs 300 gold, has 400 HP, builds in 60 seconds, occupies 2×2 dry cells and must have navigable water along one side. Normal territory, physical-footprint and builder-route rules also apply. Upkeep is 5 gold per economy cycle for human realms.
- Each completed post supports one automatic 1×3 whaling ship. Whale resources occupy 2×2 ocean cells, with every cell at least 10 tiles from any non-ocean terrain, and reveal themselves through occasional breaches. Coastal water, lakes and rivers do not spawn whales. A conservative eight-neighbor shoreline-distance map is computed once during resource generation, including islands and diagonal shorelines.
- Harvesting takes eight seconds. A resource becomes available again 15 seconds after harvest, allowing indefinite voyages. A resource can pay only one ship per availability cycle.
- Each delivered whale grants 250 gold through the normal income/research ledger and refreshes the delivering faction's movement bonus to 60 seconds. The bonus is exactly +5%, does not stack, and affects ordinary units, infantry formations, Leader galleys, warships, fishing/whaling vessels and trade boats. Further deliveries renew its duration.

## Performance and persistence

Stock, port service and dispatch decisions use a one-second clock. Geometry is shared and revisioned. Home flood fields retain their search queues, share a 4096-node update budget with local traffic detours, and cache their nearest reachable district/whale candidates. Vessel collision checks use spatial buckets and 1×2/1×3 hulls. Large district cell arrays use shared native storage and are sent to the host only when first needed. Host site membership and vessel membership use lifecycle observers and existing indices.

Saves mirror biomass, collapse flags, whale availability, vessel position/phase/routes/cargo, service clocks, replacement timers and bonus expiry. Native fields rebuild under the same search budget after restoration. No old-save migration is provided.

## Art

The user selected **fishing B, whaling ship A, whale B, post B**. PixelLab generated the sprites and movement/loading/unloading/harvesting/breach animations at 16 native pixels per cell, using existing naval and building assets as grounding. The UI icon was generated with imagegen using the existing thermal-bath UI icon as a style reference.

- Review gallery and exact prompts: `scratch/2026-11-15-fisheries-whaling/index.html`, `*-job.json`.
- Packaging script: `scratch/2026-11-15-fisheries-whaling/package-selected.py`.
- Production sheet provenance: `public/assets/fishing/maritime-source.json`.
- Production assets: `public/assets/fishing/{fishing-*,whaling-*,whale}.png` and `public/assets/ui/whaling.png`.

Sprites are byte-for-byte copies of selected generated sheets. No new sprite pixels were painted by hand. The renderer retains one texture per animation frame and rotates vessels in the GPU, rather than caching a texture per heading.

Validation: Rust/WASM compilation, full repository TypeScript checking and Vite production bundling. No tests, simulation runs or interactive playtest were run.
