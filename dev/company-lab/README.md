# Company Command prototype

Open `output/company-lab.html` directly in a browser. It contains its scripts,
styles, and Puny World artwork; no server or network connection is needed.
The prototype does not load or modify the production game or its saves.

## Controls

- Choose a landscape and force size, then watch the two armies fight.
- Click or drag to select companies; Shift adds to the selection.
- Pick an order and right-click the map. The army selector controls either side.
- Space pauses; 1, 2, and 4 change simulation speed.
- Wheel zooms, middle-drag pans, and F centers the selected companies.
- Turn off Combat to experiment with movement orders. Restart creates a fresh scene.
- Routes & slots reveals selected companies' destinations.

Each company has three soldiers, individual health, and shared veterancy.
Infantry and archers have different attack ranges. Surviving companies heal
and recruit one soldier every eight seconds when safely near their base;
destroyed companies do not return. A victorious army holds its position.

## Movement model

Long-distance navigation uses cached destination fields. A company advances as
a coordinated three-soldier column, reserving its moves together so another
company cannot cut between its members at a gate. Before fighting, it approaches
as a company and then uses separate persistent contact or waiting positions.

Destination formations leave space between companies and keep gates, bridges,
ramps, and their landings clear. A company finishes parking its whole footprint
before it rests. Local congestion uses a bounded search over the positions of
all three members, including reversing the column when necessary. Searches have
per-frame and per-orientation budgets. Motion checks retain every nearby soldier
and test separation throughout each move, including unequal arrival times.

Resting soldiers have fixed positions. They do not run continuous random
separation or formation-correction forces. Combat targets and positions are
reconsidered periodically instead of every animation frame.

## Reproduce the checks

```sh
node scripts/build-company-lab.mjs
node scripts/check-company-lab.mjs --full
npx vitest run tests/company-*.test.ts
```

The full sweep tests movement and battles on open ground, a winding river,
forest passages, a fortified town, dense streets, and terraced hills. The small,
large, and stress sizes contain 36, 360, and 720 total soldiers respectively.
Movement-only checks remove the opposing army, leaving 18, 180, or 360 walkers.

The checks measure arrival, lingering stalls, company spread, invalid terrain
or elevation transitions, physical overlap, idle drift, combat activity, and
simulation CPU time. A separate browser review measures rendering and exercises
the controls. One-cell passages have real throughput limits: the largest hill
crossing gets a longer simulation window, without weakening geometry or arrival
criteria. CPU time and simulated travel time are reported separately.

Reports and reviewed screenshots are in `scratch/2026-10-29-company-lab/`.

The final 36-case sweep passed every check. All 18 movement cases reached 100%
arrival with zero final stalls, physical overlaps, invalid steps, or idle drift.
Maximum company radius across movement and combat was 2.69 tiles. The highest
simulation p95 was 6.74 ms on this machine. These measurements cover the isolated
prototype simulation; browser rendering is measured separately.
The 35 persistent regression tests also pass.

Browser checks covered offline loading, controls, resting formations, and active
combat. Town and river battles initialized with 720 soldiers measured 9.4–11.7 ms
frame CPU p95 at 1×, and 16.5–17.8 ms at 4×. Damage continued during every sample;
the accelerated tests achieved 3.97–3.98× speed. Crowded battles can have long
queues at passages and limited fighting frontage; the UI reports these as long
waits, while the uncontested movement tests check for unresolved stalls.
