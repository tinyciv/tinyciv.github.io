# Faction AI tournament

Run `npm run sim -- ai`. The [unified simulation harness](simulation-harness.md) bundles the production simulation and loads its Rust/WASM core in Node, without a renderer or browser. Options include `--seconds=90`, `--seeds=3`, and `--scenarios=open-battle,fortified-assault,outnumbered-defense`. When using npm, put options after `--`.

The default run compares four policies in 36 deterministic trials: four policies × three scenarios × three seeds. Every policy receives identical initial units, research, resources, terrain, and positions for a given trial. Calls advance 0.1 game seconds with an injected simulated host clock; decisive game-over states stop a trial early. Results are written to `benchmarks/simulation-ai.json`, including raw unit survival, damage, kills, mission time, formation time, speed measurements, and run configuration. The historical results below compared the original three policies using the earlier 0.2-second host calls and have not been rerun with the unified runner.

## Policies

The [policy experiment system](ai-policy-experiments.md) supports named variants, JSON configuration, and paired baseline analysis. Use `--policy-file=experiments/ai-policies.json --policies=cautious` to compare an example variant against coordinated on identical fixtures. The original three builtins below remain available for comparisons; the aggressive emergency replanning threshold now follows its own retreat-health setting.

- **Legacy:** Previous garrison allocation and threat thresholds; no automatic Infantry Drill formations or military purchases.
- **Aggressive:** Formation attacks and military purchases, with a lower retreat-health threshold and greater willingness to fight unfavorable groups.
- **Coordinated:** Complete professional armies when town towers can cover the garrison; researched formation attacks that engage intercepting troops before advancing on the city; observed tower and army strength estimates; earlier retreat; reachable attack positions; regrouping and recovery from stuck ranks.

The live coordinated AI also spends earned Leader skill points, purchases affordable equipment and extra retinue capacity through normal building access, develops researched supply depots and sustainable Forts, and raises an affordable defensive levy before returning peasants to their jobs after danger passes. These economic capabilities do not confer free combat stats or ignore research requirements.

- **Expansionist (live default):** Earlier housing and wells, paid Keep and brigade upgrades, settlement expeditions, additional Forts, more frequent campaigns, and forward siege assembly. It retains real construction, research, resources and capture rules. See [policy experiments](ai-policy-experiments.md) for limits and configuration.

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

AI factions start with 1,600 gold and up to four freestanding wooden watchtowers per city, subject to terrain and available space. Their existing spaced sites retain open walking approaches. Starting grants and later replacement orders create towers without palisade rings or gate roads.

The starting and ongoing planners use the same site selection. Replacement construction respects research, charges normal construction prices, reserves productive investment and other committed upkeep, and caps each city's planned tower count. Existing towers do not trigger enclosure completion or stone-wall upgrades. Player cities, human multiplayer starts, and marauder camps use their existing rules.

The starting-defense regression fixtures retain four towers per city, check that no palisades are granted or rebuilt around them, and verify friendly and hostile access to their open repair contacts. Builder fixtures send real civilians to repair the towers and return home. Terrain cases cover marsh, fords, farms and stairs, alongside continued city growth and authoritative replacement-tower placement.

AI wooden towers cost no upkeep, including completed charges, committed-construction budgets and affordability forecasts. Human wooden towers retain their normal five-gold base charge per thirty seconds, before applicable discounts. Other settlement and defense costs keep their existing rules.
