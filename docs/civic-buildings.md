# Civic buildings and gold mine objectives

Hospitals, apartments and factories use 2×2 construction footprints. They enter the ordinary gold payment, builder work, footprint validation, farm relocation and save paths. Generated artwork remains a review step; the renderer currently reuses approved buildings, and the construction buttons reuse existing imagegen portraits.

| Building | Gold | HP | Upkeep per 30s | Requirement | Effect |
| --- | ---: | ---: | ---: | --- | --- |
| Hospital | 450 | 600 | 5 | Traditional Medicine | Friendly people within 8 tiles heal 3 HP/s after 5 seconds without damage. Hospitals do not stack. |
| Apartments | 300 | 450 | 0 | Urban Planning | 24 base beds, with the existing housing research and thermal bath modifiers. Residents use the ordinary city ledger. |
| Factory | 600 | 650 | 8 | Metal Casting | +20% realm tax income per completed factory, capped at +100%. |
| Gold mine | World objective | 1,000 | 0 | — | An equal share of a pool containing 10% of world gold earnings. |

Gold mines are neutral control points placed on the existing procedural terrain, preferentially near generated gold deposits. Placement preserves existing settlements, structures, discoveries and relief. World area determines a target of 2–12 spaced mines; insufficient suitable terrain can reduce this number. New worlds and baked scenario initialization both use the same native placement command.

A Leader or soldier within 4 tiles claims a mine after 12 uncontested game seconds. Multiple factions pause the claim; leaving or defending with the current owner resets an uncompleted claim. Ownership persists without a garrison. The selection summary shows the owner, challenger progress and contested state. Mines cannot be demolished or damaged, and city borders, captures, secessions and confederations do not transfer them.

Every paid gold receipt contributes to the world pool except refunds, transfers and the control-point dividends themselves. Every economy tick distributes the pool proportionally to mine ownership, including neutral mines in the denominator. Mine income is recorded separately in the gold ledger and is not multiplied again by scenario or AI difficulty bonuses. Pending world earnings are in the native save section; capture progress and ownership are in ordinary building snapshots.

The new rules are in `rust/src/sim/civic_buildings.rs`, a Bevy ECS resource with lifecycle-maintained factory counts, hospital spatial trees and fixed-radius mine-cell indices. Hospital/capture sensing runs at 1 Hz over the maintained Leader, soldier and wounded-unit rosters. Hospital lookup uses the owning faction's nearest spatial entry. Mine presence uses only a unit's indexed cell; mine footprints do not overlap and generated objectives are at least 24 tiles apart. With the spatial and cell indices, processing scales with the sampled units and control points rather than their Cartesian product, rather than comparing every unit with every building. Placement is linear in world area with fixed-radius marking. Receipts are constant-time counters, and dividends are linear in mine count.

Rival construction uses the existing native institution planner and bounded city continuation queue. It keeps the ordinary productive-development reserve, research gates, construction limits and normal placement commands. Hospitals need 40 local residents; apartments need 30 and limited spare housing; factories need 40 residents, funded income and fewer than five completed or pending factories. Rival troops currently capture mines when their existing movements pass a control point; this change does not add a separate mine-seeking army strategy.

`scripts/startup-civic-preview.mjs` renders a frozen sandbox city with all four kinds and the mine selection summary. It creates only an isolated in-memory fixture, advances no simulation steps and writes no saves. Verification uses the authorized `npm run test:startup` entry point.
