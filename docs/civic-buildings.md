# Civic buildings and gold mine objectives

Apartments and factories use 2×2 construction footprints. They enter the ordinary gold payment, builder work, footprint validation, farm relocation and save paths. The renderer and construction buttons reuse existing building art.

| Building | Gold | HP | Upkeep per 30s | Requirement | Effect |
| --- | ---: | ---: | ---: | --- | --- |
| Apartments | 300 | 450 | 0 | Urban Planning | 24 base beds, with the existing housing research and thermal bath modifiers. Residents use the ordinary city ledger. |
| Factory | 600 | 650 | 8 | Metal Casting | +20% realm tax income per completed factory, capped at +100%. |
| Gold mine | World objective | 1,000 | 0 | — | An equal share of a pool containing 10% of world gold earnings. |

Gold mines are neutral control points placed on the existing procedural terrain, preferentially near generated gold deposits. Placement preserves existing settlements, structures, discoveries and relief. World area determines a target of 2–12 spaced mines; insufficient suitable terrain can reduce this number. New worlds and baked scenario initialization both use the same native placement command.

A Leader or soldier within 4 tiles claims a mine after 12 uncontested game seconds. Multiple factions pause the claim; leaving or defending with the current owner resets an uncompleted claim. Ownership persists without a garrison. The selection summary shows the owner, challenger progress and contested state. Mines cannot be demolished or damaged, and city borders, captures, secessions and confederations do not transfer them.

Every paid gold receipt contributes to the world pool except refunds, transfers and the control-point dividends themselves. Every economy tick distributes the pool proportionally to mine ownership, including neutral mines in the denominator. Mine income is recorded separately in the gold ledger and is not multiplied again by scenario or AI difficulty bonuses. Pending world earnings are in the native save section; capture progress and ownership are in ordinary building snapshots.

The rules are in `rust/src/sim/civic_buildings.rs`, a Bevy ECS resource with lifecycle-maintained factory counts and fixed-radius mine-cell indices. Mine capture samples the indexed Leader and soldier rosters at 1 Hz and looks up nearby mines by unit cell. Placement is linear in world area with fixed-radius marking. Receipts are constant-time counters, and dividends are linear in mine count.

Rival construction uses the existing native institution planner and bounded city continuation queue. It keeps the ordinary productive-development reserve, research gates, construction limits and normal placement commands. Apartments need 30 local residents and limited spare housing. Factories need 40 local residents, funded income and fewer than five completed or pending factories. Rival troops capture mines when their existing movements pass a control point.

`scripts/startup-civic-preview.mjs` renders a frozen sandbox city with apartments, a factory and the mine selection summary. It creates an isolated in-memory fixture, advances no simulation steps and writes no saves. Verification uses `npm run test:startup`.
