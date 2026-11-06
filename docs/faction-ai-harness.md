# Faction AI tournament

Run `npm run benchmark:ai`. The harness bundles the authoritative TypeScript game simulation for Node and advances it without a renderer or browser. Options include `--seconds=90`, `--seeds=3`, and `--scenarios=open-battle,fortified-assault,outnumbered-defense`. When using npm, put options after `--`.

The default run compares three policies in 27 deterministic trials: three policies × three scenarios × three seeds. Every policy receives identical initial units, research, resources, terrain, and positions for a given trial. Calls advance 0.2 game seconds; decisive game-over states stop a trial early. Results are written to `benchmarks/faction-ai.json`, including raw unit survival, damage, kills, mission time, formation time, and run configuration.

## Policies

- **Legacy:** Previous garrison allocation and threat thresholds; no automatic Infantry Drill formations or military purchases.
- **Aggressive:** Formation attacks and military purchases, with a lower retreat-health threshold and greater willingness to fight unfavorable groups.
- **Coordinated:** Complete professional armies when town towers can cover the garrison; researched formation attacks that engage intercepting troops before advancing on the city; observed tower and army strength estimates; earlier retreat; reachable attack positions; regrouping and recovery from stuck ranks.

The live coordinated AI also spends earned Leader skill points, purchases affordable equipment and extra retinue capacity through normal building access, develops researched supply depots and sustainable Forts, and raises an affordable defensive levy before returning peasants to their jobs after danger passes. These economic capabilities do not confer free combat stats or ignore research requirements.

## Results, 2026-11-04

The latest 90-second, three-seed run selected **coordinated** as the default:

| Policy | Mean score | Leader survival | Mean enemy kills | Mean surviving retinue |
| --- | ---: | ---: | ---: | ---: |
| Coordinated | 261.33 | 9/9 | 11.44 | 10.44 |
| Aggressive | 238.09 | 9/9 | 10.78 | 7.33 |
| Legacy | 221.18 | 8/9 | 9.00 | 10.44 |

Coordinated scored 18.2% above legacy and preserved more troops than the aggressive policy. Score is explicitly survival-weighted: `100 × Leader alive + surviving retinue HP / 20 + enemy kills × 10 + enemy palace damage / 100`. Raw outcomes remain available so alternative weighting can be reviewed.

The controlled scenarios test open combat, an assault on a defended settlement, and defense against an oversized marauder band. Open-combat and fortified-assault opponents use fixed holding orders; the defensive scenario uses the ordinary marauder AI. These are tactical regression and policy-comparison experiments, not proof of universal superiority across every generated world or a complete long-game economic balance study. Three seeds vary reproducible placement; they do not represent a large statistical sample.

## Starting defenses and navigation

AI factions start with 1,600 gold and up to four separate watchtower enclosures per city, subject to terrain and available space. Each tower sits inside an independent 3×3 palisade ring with one cardinal road gate facing an accessible city approach. A one-cell walking lane surrounds each enclosure. Palisades are never joined into a city-wide perimeter; farms and housing can grow between the forts.

The starting and ongoing planners use the same geometry. Ongoing construction completes the gate road before closing the remaining sides, respects research, charges normal prices, reserves productive investment and upkeep, and caps each city's planned tower count. Completed layouts skip repeated path searches. Player cities, human multiplayer starts, and marauder camps use their existing rules.

`node scripts/check-faction-forts.mjs` exercises the native renderer and checks real friendly paths from each settlement to every tower's sole repair contact, hostile gate blocking, eight distinct palisades per fort, and no shared perimeter tiles. Images and results are written to `scratch/2026-11-06-faction-forts/`. Tests also send actual civilians through the gates to repair all towers and return home, and cover marsh, fords, farms, stairs, and continued paid city growth.

Tower upkeep remains unchanged. A controlled five-minute flat-world comparison against the prior rectangular starting defenses produced the same final rival population (41 across two cities), with 64 palisades instead of 104. The new layout retained more treasury gold (-72 versus -133); both no-raider scenarios eventually ran a deficit under existing settlement/tower upkeep. This defense change does not retune that economy.
