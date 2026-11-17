# AI policy experiments

Policies are named, immutable configurations of the shared faction planner. Builtins are `legacy`, `aggressive`, `coordinated`, and `expansionist`; the live game defaults to `expansionist`. Coordinated remains the experiment baseline. A variant can change numeric thresholds and enable individual capabilities without adding policy-name branches to the planner. Definitions, faction assignments, validation, and policy-dependent decision rules live in the Rust/Bevy ECS. Node handles experiment setup and analysis.

Start with the checked-in [experiment definitions](../experiments/ai-policies.json):

```sh
# Compare one change against coordinated on the same scenarios and seeds
npm run sim -- ai --policy-file=experiments/ai-policies.json --policies=cautious --seeds=10 --seconds=90 --out=scratch/cautious.json

# Compare all available policies, including every variant in the file
npm run sim -- ai --policy-file=experiments/ai-policies.json --seeds=10 --jobs=2

# Inspect names and configurable fields without running a simulation
npm run sim -- ai --policy-file=experiments/ai-policies.json --list

# Exercise a variant in a normal world with economy, development and other AI
npm run sim -- world --scenarios=default --policy-file=experiments/ai-policies.json --policies=cautious --seconds=1800 --out=scratch/cautious-world.json

# Focused native, bridge, strategy and headless harness checks
npm run test:ai
```

The AI comparison baseline defaults to `coordinated` and is automatically included when omitted from `--policies`. `--baseline=ID` selects another policy. `--scenarios=a,b` narrows the scenarios. In world mode the selected policy is assigned to each nonhuman rival civilization; human factions and villages retain their own controllers. World mode defaults to a single `expansionist` run per seed; explicit multiple policies replay each world separately. The duel scenario has no rival AI to assign a policy to.

A policy file uses this format:

```json
{
  "version": 1,
  "policies": [
    {
      "id": "cautious",
      "extends": "coordinated",
      "parameters": { "retreatHealth": 0.8 },
      "features": { "formations": true }
    }
  ]
}
```

IDs use lowercase letters, digits and hyphens, starting with a letter (up to 64 characters). `extends` defaults to `expansionist` and may reference another variant, including one declared later in the file. Duplicate IDs, cycles, unknown parents/fields, nonfinite values, inconsistent recovery thresholds, and out-of-range values are rejected. The parent reads the file once, records its hash, and sends the same definitions to every worker. Defining or selecting policies does not consume simulation RNG, grant resources, bypass research, or change unit combat stats.

| Parameter | Coordinated default | Meaning / range |
| --- | ---: | --- |
| `retreatHealth` | 0.72 | Retreat below this HP fraction; 0–1 |
| `retreatPowerRatio` | 1.15 | Retreat when observed enemy power exceeds friendly power times this ratio; 0.01–10 |
| `huntPowerRatio` | 1.4 | Friendly power required relative to a bounty group; 0.01–10 |
| `garrisonFraction` | 0.25 | Fraction of available army to reserve; 0–1, with at least one reserved unless tower coverage releases it |
| `towerGarrisonCount` | 2 | Nearby ready towers needed to release the professional garrison; integer 1–100 |
| `hostileTowerPower` | 3200 | Observed hostile tower strength estimate; 0–1,000,000 |
| `hostileFortPower` | 6400 | Observed hostile Fort strength estimate; 0–1,000,000 |
| `friendlyTowerPower` | 1600 | Nearby friendly tower support estimate; 0–1,000,000 |
| `campaignSafetyRatio` | 0.8 | Maximum campaign danger relative to projected power; also sizes the required levy; 0.01–10 |
| `campaignDangerWeight` | 40 | Danger penalty added to campaign travel time; 0–1000 |
| `retreatMorale` | 40 | Retreat below this morale; 0–100 |
| `recoveryHealth` | 0.9 | HP fraction needed to leave recovery; at least `retreatHealth`, up to 1 |
| `recoveryMorale` | 75 | Morale needed to leave recovery; at least `retreatMorale`, up to 100 |
| `recoveryPowerRatio` | 0.6 | Maximum enemy/friendly power ratio when leaving recovery; 0–10 |
| `decisionInterval` | 1 | Seconds between normal planning passes; 0.5–10; emergencies still interrupt |
| `formationEnterCount` | 8 | Soldiers needed to form; integer 1–1000 |
| `formationStayCount` | 6 | Soldiers needed to retain a formation; integer 1–`formationEnterCount` |

The original nine features default to true for coordinated: `formations`, `militaryPurchases` (including earned skill spending), `towerGarrison`, `towerAwareness`, `interceptEnemies` (during campaigns), `defensiveLevy`, `campaignLevy`, `safeCampaigns`, and `formationApproach` (stand off from troop targets). Existing prerequisites and normal purchase/command validation still apply. Feature ablations, such as `no-formations`, measure the contribution of a capability rather than changing unit stats.

AI reports contain the existing survival-weighted score and raw Leader survival, troops, kills, damage, and mission time. Each trial also records its full resolved policy, applied factions, seed, and a hash of the host-visible initial fixture taken before policy registration. The `paired` section matches each candidate to the baseline by scenario and seed, verifies equal initial hashes, and reports score wins/ties/losses, mean score delta, paired standard deviation, an approximate 95% interval, and survival/kill/troop deltas. It also reports each scenario separately. Missing, duplicated or mismatched pairs fail the experiment rather than silently affecting a ranking.

The interval is a normal approximation (`mean ± 1.96 × standard error`), a descriptive estimate that can be unreliable with few seeds. One pair produces no interval. The three controlled scenarios measure tactics against fixed opponents, not self-play or complete campaign quality. Start with one change at a time; compare across scenarios, retain the baseline, and verify promising variants with additional held-out seeds and longer world runs. A short harness smoke check is evidence that the experiment system works, not that a variant improves the AI. World reports retain the richer checkpoint metrics; use `sim compare` to compare reports with matching scenarios/seeds/steps, selecting one policy per report.

The expansionist policy additionally enables `proactiveHousing`, `foundCities`, `fortifyCities`, `offensiveSiege`, and `territorialWars`. It supplies six housing credits per 30 seconds (bank capped at four), permits four pending homes, plans city development every four seconds, adds wells covering two homes rather than waiting for three, and purchases Keep housing and Fort brigades through normal Leader access. Existing tower enclosures are upgraded to stone after Masonry; their gates remain passable and the enclosures are not joined into a city-wide perimeter.

| Additional parameter | Coordinated | Expansionist | Range |
| --- | ---: | ---: | --- |
| `housingOrdersPerCycle` | 2 | 6 | 0.2–12 |
| `developmentInterval` | 6 | 4 | 2–30 seconds |
| `cityLimit` | 0 | 6 | Integer 0–12; founding cap, not a conquest cap |
| `populationPerCity` | 45 | 35 | 20–200 |
| `reserveUpkeepCycles` | 2 | 1.5 | 1–5 |
| `campaignCooldown` | 40 | 20 | 10–120 seconds |
| `siegeLimit` | 0 | 2 | Integer 0–4 engines per target |
| `fortsPerCity` | 1 | 2 | Integer 0–3 |

Native empire planning runs once every three seconds per rival and inspects one placement candidate each time. City expeditions require two available soldiers, sufficient population and food, normal treasury payment, and a connected site at least 14 tiles from existing friendly cities. Pending cities count against the cap; founding orders have a two-minute cooldown. A funded first Fort precedes further settlement, with additional Forts allowed when affordable. Growth investment can use a limited treasury runway through a temporary deficit, while reserving productive construction and upkeep; it does not grant free resources.

Siege engines are stationary buildings, so campaigns lead the army to a reachable assembly site within weapon range of the objective. Both require normal research; siege cannons also require developed iron, while ballistae do not. Cannons are preferred only when developed iron is available and recurring income can sustain their 100-gold upkeep; otherwise the AI uses ballistae. The army covers assembly and waits for observed defenses or the palace to be weakened, engaging nearby enemy troops first. An engine that has not fired for 75 seconds stops holding up the army, and campaign deadlines remain finite. Expansionist diplomacy may start a war after contact when observed strength favors it by at least 20%; active treaties and truces still prevent this opportunity rule. Territory changes use ordinary combat and capture rules.

Empire plans are runtime work queues; loading a save replans unpaid expeditions. Completed and paid construction, policy definitions and faction assignments retain normal save behavior. No long-game balance claim is made by these defaults; use the harness to compare expansionist with coordinated and the supplied `expansion-no-siege` / `expansion-cautious` ablations.

The host API is `registerFactionAIPolicies(state, definitions)`, `setFactionAIProfile(state, faction, id)`, and `listFactionAIPolicies(state)` in `src/game/faction-ai-profile.ts`. Policy views are immutable and cached. Changing the selected policy invalidates the current strategy plan immediately; native snapshots preserve definitions and per-faction assignments. Adding a new decision algorithm belongs in `rust/src/sim/ai_policy.rs`; add observations or capabilities to the bridge as needed, retaining the existing planning clocks and normal commands. The JSON format configures the shared planner and does not execute custom JavaScript policies.


For direct policy-versus-policy matches, use `sim match` or the two-stage [experiment loop](simulation-harness.md#direct-policy-matches-and-experiment-loops). The [2026-11-15 plan](../experiments/2026-11-15/experiment.json) compares the live expansionist baseline with harder attacks, more cautious retreat thresholds, and formation-free combat, then validates qualifiers on fresh seeds. Match victories are actual faction defeats; the earlier survival-weighted score remains specific to `sim ai` fixed-opponent scenarios.

For multi-generation parameter and decision-rule evolution, use [iterative AI search](ai-search.md): `npm run ai:search -- experiments/ai-search.json benchmarks/creative-ai-001`. It retains ancestry and diverse parents, validates challengers on fresh seeds, and supports resuming a frozen-engine run.

The [second iteration](../benchmarks/ai-iteration-2/README.md) evaluated army concentration and conditional recovery through three search generations and a separate 24-seed mirrored tournament. Both `field-concentration` and `evolved-assault` improved on expansionist and the earlier hard-assault contender in controlled field combat. Definitions and reproduction commands are in [experiments/ai-iteration-2](../experiments/ai-iteration-2/README.md); the report separates combat evidence from fortified and generated-world transfer checks.

Rivals now also use [AI institutions](ai-institutions.md): native decisions fund and place granaries, establish barracks and advanced infantry targets, and construct forums for normal culture-funded achievement purchases. These paths share the existing city/strategy clocks, normal commands and upkeep budgets.
