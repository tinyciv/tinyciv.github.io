# Faction AI and military support

Enemy civilizations begin with 100 additional gold (1,600 total), a gated palisade enclosure and four watchtowers around each starting city. These are completed starting defenses; later construction and maintenance use the ordinary treasury. Human multiplayer opponents receive equal human starts.

The AI assesses nearby combat strength, health, morale, reinforcements and observed tower coverage. It gathers escorts, attacks in Infantry Drill formations when researched and sufficiently staffed, retreats from unfavorable fights, and keeps defenders near home. Its economic planner reserves wages, improves equipment, spends Leader skill points and develops support buildings through the normal rules.

Run the deterministic headless comparison with:

```sh
npm run benchmark:ai -- --seconds=90 --seeds=3
```

The harness runs the actual simulation with identical conditions for legacy, aggressive and coordinated policies. Open battles, fortified assaults and outnumbered defense measure Leader survival, casualties, remaining health, damage to enemy settlements and time spent in formation. The report is written to `benchmarks/faction-ai.json`. The recorded 27-run comparison selected coordinated AI: mean score 261.33 versus 238.09 for aggressive and 221.18 for legacy, with Leader survival in 9/9 coordinated runs versus 8/9 legacy runs. The score is an explicit scenario metric, not a claim about universal win rate; longer campaigns and additional maps can be assessed by extending the harness. See the [AI harness report](faction-ai-harness.md) for policy details, scenario limitations, navigation checks and startup measurements.

## Fort

- Build with **F, then V** after Masonry. Costs **300 gold**, occupies **2×2 tiles entirely inside your own borders**, and takes **60 seconds** to construct.
- Has the health and armor of a masonry wall, including applicable research/equipment bonuses. Fires arrows at **two distinct targets** per volley with watchtower damage, range and cadence.
- Costs **20 gold every 30 seconds**. An unpaid Fort suspends attacks and recalls its patrol until service can be funded.
- Projects borders with a base radius of **6.5 tiles**, plus cultural growth. Each friendly completed monument within ten tiles adds two tiles, capped at six additional tiles.
- Combat destruction leaves a permanent foundation belonging to the original faction. Enemy border expansion and area clearing cannot take or remove it. Approach with the Leader and use **Rebuild Fort** for **150 gold**, retaining brigade upgrades. The owner may explicitly clear their own Fort.
- Buy **Skirmisher Brigade** in the Fort popup: **150 gold for 3**, then **200 for 6**, then **300 for 10** skirmishers. They patrol up to twelve tiles, throw javelins at range five, and evade enemies approaching within three tiles. They are independent of the Leader's retinue.

## Supply train

Research **Supply train** after Traditional Medicine. Build a **Supply depot** with **B, then Z** for **120 gold** (45 seconds).

Each depot sends a physical civilian handcart toward the living, disembarked Leader every thirty seconds, with at most one cart outstanding per depot. A delivery restores up to **10 HP to the Leader and every living friendly unit**, capped at each unit's maximum health. Carts have 40 HP, can be killed, use no population, and award no gold when destroyed.

## Mass levy

Research **Mass levy** after Military Tactics. Press **4** to raise available peasants, capped at one third of faction population and the affordable number. The same **4** action becomes **Dismiss levy** while soldiers are active. **5** is the separate Garrison / Recall Garrison action.

Levy Infantry retain their civilian identity and home, carry spears, and have half a warrior's base attack and defense (8.5 and 2). They receive weapon/armor upgrades, have a maximum of **80 morale**, and occupy the wings of formations. Mobilized residents cannot also staff civilian jobs.

Each levy costs **15 gold on mobilization**, then **5 gold every 30 seconds thereafter**, with the first upkeep payment due 30 seconds after mobilization. Drafting must leave a positive treasury. Dismissal gives no draft-fee or wage refund. When the treasury runs out or wages cannot be paid, the levy immediately stops fighting, routs home and resumes its former civilian work. Death removes a resident; dismissal does not.

New roles reuse the game's existing artwork through runtime composition. All new in-game text uses Pixel Operator.

## Verification

```sh
npx vitest run tests/forts.test.ts tests/supply-levy.test.ts tests/faction-ai-upgrade.test.ts tests/faction-strategy.test.ts tests/faction-development.test.ts tests/faction-ai-integration.test.ts --maxWorkers=2
npm run build
# With the development server running:
GAME_URL=http://127.0.0.1:5177/ node scripts/check-forts-supply-levy.mjs
```
