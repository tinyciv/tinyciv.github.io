BTV navigation laboratory
=========================
Open output/navigation-lab.html from the project root in a browser, or:
http://127.0.0.1:5175/output/navigation-lab.html

The HTML is self-contained and never reads or writes the saved game.
Regenerate the inline application and numeric comparison using:
  npm run lab:navigation
Regression checks:
  npx vitest run tests/navigation-benchmark.test.ts tests/movement-contact.test.ts

Baseline: baseline-simulation.ts is a frozen copy of the pre-change production
simulation with import paths redirected and moveUnit exported for traffic tests.
Retired building hooks are removed to keep its shared-module imports valid;
the navigation comparison scenarios do not use those features.
The optional congestion parameter added to the current pathfinder is absent from
baseline calls, so the baseline retains the previous A* route costs. Both sides
share the same static grid/collision, farming and construction modules. Fixtures
contain no farms or construction, no economy ticks, and identical combat stats.

Current: main.ts imports the actual production simulation, not a visual imitation.
The build script bundles both drivers into the standalone artifact. Scenario
construction and measurements are shared by HTML and automated tests.

24-second deterministic comparisons (0.1-second steps):
                       Engaged before -> now   Idle unit-seconds before -> now
  Open melee             8/12 -> 12/12              75.6 -> 0.0
  Two-cell choke        10/12 -> 12/12              73.7 -> 0.6
  Obstacle flank         7/12 -> 12/12              93.7 -> 0.0
  Crossing traffic   22/24 arrived -> 24/24         82.4 -> 26.2
Every current scenario has zero samples with two living units in the same cell.
Maximum uninterrupted idle time in combat is 0.6 / 1.4 / 0.7 seconds, previously
21.2 / 17.4 / 20.0 seconds. Crossing traffic maximum falls 12.0 -> 5.7 seconds.

Idle unit-seconds excludes actively fighting units and completed destinations,
and starts after one second of uninterrupted stationary waiting. Engagement
means dealing or receiving damage within 1.1 seconds. The combat fixtures use
high health to keep both armies alive, holding geometry steady for the whole run.
Do not interpret these four fixtures as proof of optimal or deadlock-free motion
on every possible map.

Implementation:
- Distinct reserved contact cells, retained while pursuing the same target.
- Military-first target choice remains; when a nearby military target has no free
  contact position, reinforcements can select another military target.
- Engaged allies block combat routing and do not yield to rear-rank soldiers.
- A* adds short route-intention and occupancy costs, encouraging separate lanes.
- Yielding uses normal pathfinding rather than a permanently blocked straight
  sidestep; arrived units clear stale paths and can yield to incoming traffic.
- Full-cell occupancy, diagonal corner passages, walls/gates and terrain travel
  multipliers remain enforced. Leader movement retains highest right of way.

Primary sources consulted:
David Silver, Cooperative Pathfinding (2005):
https://ojs.aaai.org/index.php/AIIDE/article/view/18726
https://ocs.aaai.org/Papers/AIIDE/2005/AIIDE05-020.pdf
Craig Reynolds, Steering Behaviors For Autonomous Characters (1999):
https://www.red3d.com/cwr/papers/1999/gdc99steer.html

These are reservation/congestion heuristics inspired by those sources, not a full
space-time Cooperative A*, WHCA*, or ORCA implementation. Continuous terrain
speeds and hostile agents make static full-horizon route reservations unsuitable
without substantially broader movement changes.

Enemy pressure:
New worlds: 10-12 packs per settled faction, previously 8-10.
Opening packs: 3 soldiers, 65 HP / 10 attack (previously 2, 55 HP / 8 attack).
Other packs: 4 soldiers, 80 HP / 12 attack (previously 3, 70 HP / 10 attack).
Opening departures: 40-45s and 86-91s; time for initial setup remains.
Faction raids: up to2 early instead of1, later3+ instead of2+; recurrence70-120s
instead of85-150s. Existing living packs upgrade once, retaining damage ratios,
identity, positions and approach timers; one nearby reinforcement may join each.
Dead packs stay dead. Generated BTV-847 and marauder-connected-valley opening
regressions still reach two encounters within120s without player defeat.
