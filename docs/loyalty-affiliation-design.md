# Loyalty, affiliation, confederation and village evolution: design

Status: design only, with no game code changes yet. Date: 2026-11-11. Source task: TODO.md "Overhaul loyalty and affiliation system".

This document is the implementation spec. Constants, strides, file names and test names are written so an engineer can build it without asking further questions. Where a choice was open, the chosen default is stated and the alternative is listed in section 15.

---

## 0. Summary

1. **One score.** Every settlement (a civilization city, a neutral village, or a seceded city) keeps an *affiliation* value from 0 to 100 toward every civilization faction. **Loyalty** is the settlement's affiliation toward its current owner. Faction `affinity` and `CityLoyalty` are removed.
2. **Three primary drivers**, plus small owner-only governance terms:
   - **Culture.** Shared cultural alignment is 100% for your own people and lower for other villages or factions. It drifts through assimilation.
   - **Trade.** Delivered caravan gold involving the settlement and a faction, decayed over time.
   - **Threat.** How often and how close armed units come, sensed at 1 Hz from a native sector census. Hostile threat lowers loyalty to the owner. Aggressors earn fear and resentment. Protectors earn credit.
3. **Villages become elaborate.** They have five stages (Camp, Hamlet, Village, Large village, Town) and four layout families (Roadside, Market cross, Riverside, Hill cluster). They place real roads, house groups, wells, guard posts and towers through the existing physical placement rules. They adopt building kinds (library, blacksmith, dock, and so on) that nearby factions have.
4. **Confederation.** A player, or an AI civilization, can request that an allied village confederate. Acceptance is deterministic and transparent: affiliation must reach the village's independence minus 10. Villages can also petition to join. A confederated village becomes a real city: a palace is placed on its reserved civic lot, and it keeps its identity bonus.
5. **Architecture.** All rules live in a new Rust/bevy_ecs settlement engine. That engine holds persistent components, ordered schedules, changed-row publication and batched FFI. TypeScript keeps encoding, views, UI, rendering, and *host-applied effects*: placing an approved building, or executing an approved ownership transfer. These host effects follow the precedent of construction.rs, where "Clearance and scenery changes are synchronous host effects between prepare and finish commands."

---

## 1. Current implementation (what is replaced)

| Area | Today (TS) | Problem for the new design |
|---|---|---|
| City loyalty | `loyalty.ts` and `loyalty-model.ts`. The target is `70 + support + civic + monument + 3·guards − 55·√borderPressure − trauma`. It runs every 5 s, with a 120 s grace and secession at 0. | Driven by border perimeter contact, not by trade or units. A perimeter pass and an all-buildings pass run every 5 s. Only marauder casualties count. |
| Faction affinity | `Faction.affinity`, random at creation (player 100, last rival 18–34, others 50–90). Used only by `diplomacyAction('confederate')`, with chance `(0.15 + 0.007·affinity)·(war ? .5 : 1)`. | A static number unrelated to anything in play. |
| Villages | `villages.ts`. Three tents. Every 90 s, `developVillage` buys houses, 2 guard posts and 4 towers within radius 6 with trade gold, in random clumps. `updateVillages` filters `state.buildings` and `state.units` per village every 0.5 s. `nearbyThreats` filters *all units* per village every 0.5 s. | No layout, no roads, no evolution. Expensive scans. Diplomacy is pure gold (trade 250, alliance 3000 minus a trade discount). |
| Village relations | `NeutralVillage.relation/relationsByFaction/alliedFaction/trading/tradingFactions/tradeGoldByFaction`, `village-relations.ts`, and `villageHostility` (a linear `state.villages.find` inside `atWar`). | Hot-path hostility does linear finds. The state is spread over many optional fields. |
| Secession | `city-secession.ts` converts a city into a white "village" faction with `secededCity`. Reconquest goes through `finishSecededCityCapture`. | Decision and transfer are mixed together. |
| AI village trade | `trade.ts: establishFactionVillageTrade`. | AI decision logic lives in TS. |

The Rust crate currently owns entities, navigation, progression, combat math, cadence, population, movement (resident transforms and occupancy), health, construction lifecycle, projectiles, morale and research. It has no settlement or diplomacy state.

---

## 2. Vocabulary

- **Settlement**: one row per completed civilization palace, per neutral village (keyed by its hub tent `campId`), and per seceded city (keyed by its palace). Settlement id is the key building id.
- **Owner**: the faction that owns the settlement. For a neutral village, this is the village's own white faction.
- **Target faction**: a civilization faction (`id ≥ 0`, `villageId === undefined`, not defeated). Affiliation is tracked toward these factions only, in at most 15 slots. Slot 15 is reserved for marauders (`-2`), for exposure bookkeeping only.
- **Affiliation `v(s,f)`**: a value from 0 to 100. **Loyalty** is `v(s, owner(s))` for civilization-owned settlements.
- **Independence `I(v)`**: a village's attachment to staying independent. It is computed, not integrated (section 4.7).
- **Heritage**: the civilization a settlement's people came from (civ index), or the "kin" civ for a village.
- **Alignment `A(s,f)`**: cultural alignment from 0 to 1. The culture term is `K = 100·A`.

---

## 3. Data ownership

### 3.1 Rust owns (authoritative, saved through the settlement snapshot)

All of these live in one bevy `World` inside `SettlementEngine` (one engine per `GameState`, handle-based like `health`/`research`).

Components (one entity per settlement):

| Component | Fields |
|---|---|
| `Settlement` | `id: i64`, `kind: City \| Village \| SecededCity`, `owner: i32`, `x, y: f64` (key building origin), `population: f64`, `founded_at: f64`, `village_id: i32` (−1 for none), `identity: u8` (village identity or 255) |
| `Heritage` | `civ: i8` (−1 none), `kin_civ: i8` (villages), `former_owner: i32` (seceded) |
| `Affiliation` | Per slot `[f64; 16]` each for `value`, `target`, `rate`, `alignment`, `trade_volume`, `exposure`, `protector`, `snub`. Also `grace_until: f64` and `warning: bool`. |
| `Civic` | Counts maintained incrementally: `guard_posts`, `towers`, `forts`, `advanced`, `monument: bool`, `nearest_same_owner: f64` |
| `Presence` | Last sensed `[f64; 16]` weighted presence per slot, `hostile_total`, `friendly_total`, `hostiles: SmallVec<[i64; 8]>` (village defenders), `sensed_at` |
| `VillageState` | `stage: u8`, `family: u8`, `transform: u8`, `treasury: f64`, `lifetime_income: f64`, `relations: [u8; 16]` (0 neutral, 1 trade, 2 allied, 3 war), `trading: u16` bitmask, `lifetime_trade: [f64; 16]`, `cooldown_until: [f64; 16]`, `petition: (slot, since, next_allowed)`, `next_growth_at`, `next_recruit_at`, `next_adopt_at`, `next_ai_at` |
| `VillagePlan` | `slot_status: Vec<u8>` (0 pending, 1 built, 2 skipped, 3 transient-retry), `alternates_used: Vec<u8>`, `adopted: u32` bitmask, `adopted_from: [i8; 12]`, `lot_assignments: [u8; 4]`, `claim_revision: u32` |
| `PendingRequest` | Outstanding build request ids for this village (at most 1 group) |

Resources:

| Resource | Purpose |
|---|---|
| `FactionTable` | id→slot map, civ index per slot, flags (defeated, human, confederated), gold and population snapshot, civ war matrix (TS-owned civ diplomacy input), hostility matrix (computed output), `revision` |
| `CivicIndex` | `BTreeMap<i64 building id, CivicRow>` plus a sector index (8×8-tile sectors) of ready civilization buildings by kind, used for adoption scans and civic counts |
| `Clocks` | `next_sense_at`, `last_sensed_at`, `next_integrate_at`, `last_integrated_at` (elapsed-preserving via `cadence::next_deadline`) |
| `Inbox` | FIFO of host events since the last step: trade receipts, casualties, civic changes, settlement upserts, build results, transfer commits, relation changes |
| `Outbox` | Changed settlement rows, events, build requests, spawn rows, charges, `hostility_revision` |
| `Rng` | SplitMix64 state seeded from `hash(world seed, "settlements")`, saved. Used only for civilization confederation rolls. |
| `Templates` | Parsed layout templates (static, not saved) |

### 3.2 `movement.rs` owns the sector census (a new incremental counter)

`movement::Engine` already publishes every live, non-sleeping actor through `actor()` and `remove()`. Add:

```rust
pub const SECTOR: i32 = 8;
struct SectorCensus {
    sectors_x: i32,
    // military actors only: kind in 5..=16, hp > 0, flags & INSIDE == 0
    members: BTreeMap<i64 /*sector*/, Vec<i64 /*actor id*/>>,
    of_actor: BTreeMap<i64, i64>,            // actor -> sector it is counted in
}
```

`actor()` computes `military && alive && !inside` and the sector `floor(y/8)·sectors_x + floor(x/8)`. It updates `members` only when membership or the sector changes, which is O(1) amortized per publish. `remove()` removes the actor. A read-only query, `for_each_military_in_rect(x0,y0,x1,y1, |actor| ...)`, visits only overlapping sectors. This is the "existing spatial index plus counter" the sensing uses. There are no all-pairs scans and no TS round trip.

### 3.3 TypeScript keeps

- **Encoding and bridge** (`src/game/settlement-bridge.ts`): buffers, observers that enqueue civic and settlement changes, scalar event calls, memory-growth-safe views, snapshot flush and import.
- **Views** (`src/game/settlement-view.ts`): an immutable `Map<settlementId, SettlementView>` rebuilt only from published changed rows. It also holds the hostility matrix view, village relation and trading view, the per-faction village bonus view, and claim-cell lists. Read helpers include `loyaltyOf(state, palace)`, `loyaltyWarning(view)`, `loyaltyPanelAlpha(...)`, `villageStage(state, village)`, `villageRelationView(state, village, faction)`, `villageTrading(state, village, faction)` and `hostileView(state, a, b)`.
- **Host-applied effects**:
  - `src/game/village-sites.ts`: physical validation and instant placement of Rust-approved village buildings, and villager/guard spawns.
  - `src/game/settlement-transfer.ts`: execute Rust-approved ownership transfers (secede, capture, confederate a village, confederate a civilization).
- **UI and rendering**: popups, city panel, ribbon, wreath art, Storybook.
- **Still TS-owned inputs** (not yet migrated, pushed into Rust on change): civilization `Faction.relation` (peace or war), `Faction.gold` for civilizations, building and unit entity state, territory, and village founding position sampling (world creation).

---

## 4. Score model

All constants live in `rust/src/affiliation.rs` and are exposed through `settlement_constant(index)`. Index order is the order of the table in 4.10.

### 4.1 Culture alignment `A(s,f)`

Civilization families, indexed by `CIVILIZATIONS` order in `src/game/civilizations.ts`:

| Family | Civs (index) |
|---|---|
| Aegean–Italic | Roma (0), Greeks (2) |
| Levant–Punic | Phoenicians (6), Carthaginians (7) |
| Nile | Egyptians (1), Nubians (10) |
| Mesopotamia | Babylonians (4), Assyrians (5), Sumerians (9) |
| Anatolia–Iran | Persians (3), Hittites (8) |

Family adjacency: Aegean–Italic↔Levant–Punic, Aegean–Italic↔Anatolia–Iran, Levant–Punic↔Nile, Levant–Punic↔Mesopotamia, Mesopotamia↔Anatolia–Iran.

Base alignment `B(civA, civB)`: same civ **1.00**, same family **0.60**, adjacent family **0.45**, otherwise **0.30**.

Initial `A(s,f)`:
- **City**: `B(heritage(s), civ(f))`. A newly founded city has the owner's heritage, so its alignment to the owner is 1.0. A conquered city keeps its heritage.
- **Village**: `kin_civ` is the civ of the starting capital nearest the village at founding (ties go to the lower faction id). Alignment is `A = 0.55` toward the kin faction, `0.45` toward factions of the kin's family, and `0.35` otherwise.
- **Seceded city**: `0.80` toward the former owner. Toward others it is `B(heritage, civ(f))`.

Drift, applied every integration tick with elapsed `Δt`:
- **Assimilation by owner**: while `v(s,owner) ≥ 50`, `A(s,owner) += (1 − A)·Δt/1200`.
- **Allied village**: while allied with `f`, `A(v,f) += (max(0.70, A) − A)·Δt/900`. It never decreases through this rule.
- **All other pairs** relax toward base: `A += (A0 − A)·Δt/2400`, where `A0` is the initial value above.

Culture term: `K(s,f) = 100·A(s,f)`. It enters targets as `W_CULTURE·K` with `W_CULTURE = 0.55`.

### 4.2 Trade term

`V(s,f)` is decayed trade volume in gold, with half-life 240 s. Delivered gold is added at `finishDelivery`, before any other gold handling, through `settlement_trade(handle, settlementId, factionId, gold, kind)`:

| Delivery | Credit |
|---|---|
| Village caravan of faction `f` to village `v` | `V(v,f) += gold`. `V(origin city, owner) += 0.5·gold`. Village `lifetime_trade[f] += gold` (the alliance discount ledger). Village `treasury += gold` (replaces `grantIncome` to the village faction). |
| Domestic caravan between cities `a` and `b` of faction `f` | `V(a,f) += gold` and `V(b,f) += gold` |
| Inter-civilization caravan from city `a` (faction `f`) to city `b` (faction `g`) | `V(a,g) += gold`, `V(b,f) += gold`, `V(a,f) += 0.5·gold`, `V(b,g) += 0.5·gold` |

`R(s,f) = TRADE_MAX·(1 − exp(−V/TRADE_SCALE))`, with `TRADE_MAX = 25` and `TRADE_SCALE = 40` gold. One 60-second village leg pays about 27 gold, or 108 with the required resource. Two caravans per minute keep R near 20.

### 4.3 Threat sensing: frequency and proximity

**Sensing runs at 1 Hz**, in the `sense_presence` system. Elapsed time is preserved: if a step arrives late, the sample is held over the real elapsed time.

For each settlement `s`, with center `c` at the key building origin plus `(1,1)`:
- The radius is `R = 14` for cities and seceded cities and `R = 12` for villages. The core radius is `R_core = 4`.
- Query the census rectangle `[c−R, c+R]`. That is at most 16 sectors at R = 14.
- For each military actor `u` with faction `g ≠ owner(s)` and distance `d ≤ R`:
  - `w(d) = clamp((R − d)/(R − R_core), 0, 1)`
  - `k(u)` is the kind weight: leader 2.0; horseman, horseArcher and knight 1.25; warrior, swordsman, spearman, archer, levyInfantry, slinger, skirmisher and militia 1.0; scout 0.3. Movement kind codes are 5–16; every other kind weighs 0.
  - Marauders (`g = −2`) get a ×1.25 multiplier.
  - `P(s,g) += k(u)·w(d)`
- The owner's own and allied presence, `P_friend(s)`, uses the same weights. Allied means the village's ally for a village, and the village allied with the owner for a city. It feeds protection and protector credit.
- Villages also record the 8 nearest hostile actor ids within `R` for `updateVillageUnit` (section 8.9).

Classification uses the hostility matrix (section 6.4):
- **Hostile** (`hostile(owner(s), g)`): weight 1.0 into both `E(s,g)` and the hostile total.
- **Armed foreign, not hostile**: intimidation weight `0.25` into `E(s,g)` only. Examples are an unallied village and raiders, which do not fight each other, or a neutral civilization's army parked beside a city.

Exposure, with half-life 180 s, in "unit-minutes":

```
E(s,g) ← E(s,g)·2^(−Δt/180) + weight·P(s,g)·Δt/60
E_hostile(s) = Σ_{g hostile} E(s,g)
```

Civilian casualties are reported by `settlement_casualty(handle, settlementId, attackerFaction, population)`. This replaces `recordLoyaltyCasualty` and now covers any hostile attacker, not only marauders:
`E(s,g) += 1.5·20/max(20, population)`.

Derived terms:
- **Threat** (owner and independence): `H(s) = 45·(1 − exp(−E_hostile/3))·(1 − Prot(s))`
- **Protection**: `Prot(s) = min(0.6, 0.10·guardPosts + 0.05·towers + 0.15·forts + 0.04·min(5, P_friend))`. Towers are `woodenTower` or `tower`.
- **Fear** (toward an aggressor `g`): `F(s,g) = 30·(1 − exp(−E(s,g)/3))`
- **Protector credit** (toward a non-hostile `f ≠ owner` whose military is present while hostiles are present):

  ```
  D(s,f) ← D·2^(−Δt/300) + min(P(s,f), P_hostile(s))·Δt/60
  C(s,f) = 12·(1 − exp(−D/2))
  ```

  The owner's own protection is already counted in `Prot`.

Frequency and proximity are both captured. A single scout passing 8 tiles away for 10 s adds `E ≈ 0.03`, which is negligible. Four raiders camping 6 tiles from a palace for 3 minutes reach `E ≈ 8.7` and saturate the threat term.

### 4.4 Governance (owner, civilization cities only)

`G(s) = 15 + support(nearestSameOwnerCity) + min(20, 4·advanced) + 12·monument`

- `support(d) = clamp(12 − max(0, d − 20)·0.6, −24, 12)`, and 0 when the city is the faction's only city. This is today's formula.
- `advanced` counts the existing `ADVANCED` kinds: library, blacksmith, archeryRange, stable, scoutLodge, healerShack, dock, supplyDepot and fort.
- Guard posts no longer add flat loyalty. They count through `Prot`, so they matter when threatened. Update `src/ui/action-tooltips.ts` to say so.
- Civic counts come from `CivicIndex`. A building belongs to the nearest same-owner settlement (squared distance, ties to the lower id, the same rule as `population.rs::assign_homes`). Membership is recomputed only when the settlement set revision changes. Otherwise it changes per civic row.

### 4.5 Targets

For a civilization-owned settlement `s` with owner `o`:

```
T(s,o) = clamp(0.55·K(s,o) + G(s) + R(s,o) − H(s) − S(s,o), −40, 100)
```

For any settlement `s` toward a target faction `f ≠ owner(s)`:

```
T(s,f) = clamp(0.55·K(s,f) + R(s,f) + 10·[village allied with f] + C(s,f) − F(s,f) − S(s,f), 0, 100)
if relation(s,f) is war: T(s,f) = min(T(s,f), 20)
```

Snub `S(s,f)` is +5 per refused request, with half-life 120 s (section 7).

### 4.6 Integration

The integration tick runs every 5 s with real elapsed time, chunked at 5 s so a long pause integrates in steps.
- Owner rows: `rate = clamp((T − v)/180, −0.30, +0.20)`. While `now < grace_until` and `rate < 0`, `rate = 0`. Then `v = clamp(v + rate·Δt, 0, 100)`.
- Non-owner rows: `rate = clamp((T − v)/240, −0.25, +0.25)`. No grace.
- Initial values:
  - New city: `v(owner) = 75`, `grace = now + 120`.
  - Captured city: `v(conqueror) = 60`, grace 120.
  - Confederated city: `v(new owner) = max(v_prev, 60)`, grace 120.
  - Non-owner rows start at `0.55·K` (no trade, no fear).
- Warning: `warning = rate < −0.01 && (T < 25 || v < 30)`, the existing semantics.
- Secession: a civilization city whose owner loyalty reaches `v ≤ 0` emits `EVENT_SECEDE`. Rust marks it `secede_pending`, and only `settlement_commit_transfer` clears the mark (section 7.5).

### 4.7 Village independence

```
I(v) = clamp(70 + 3·stage + 2·guardPosts + 5·[adopted library] + 5·[adopted monument] − H(v), 0, 100)
```

A threatened, unprotected village becomes more willing to join a protector.

### 4.8 Consequences and gates

| Gate | Rule |
|---|---|
| City loyalty warning | `warning` flag (4.6) |
| Secession | `v(s,owner) ≤ 0` |
| Village trade (viewer `f`) | Not at war. `v(v,f) ≥ 15`. Cost 250. |
| Village alliance | Not at war. `v(v,f) ≥ 45`. Cost `max(500, 3000 − 5·floor(lifetime_trade[f]/50))` (unchanged). |
| Village confederation request | Allied with `f`. Not on cooldown. Gold ≥ tribute. Leader reach (unchanged rule). Accepted iff `v(v,f) ≥ max(60, I(v) − 10)`. |
| Village petition | Allied with `f`, and `v(v,f) ≥ max(80, I(v) + 15)` continuously for 120 s. At most one per 600 s per village. |
| Civilization confederation | `Aff(g→p)` is the population-weighted mean of `v(s,p)` over `g`'s ready cities, or the unweighted mean if all populations are 0. `chance = clamp(0.10 + 0.008·Aff, 0.05, 0.90)·(war ? 0.5 : 1)`. On a failed roll, a second roll with `(100 − Aff)/130` declares war. The 30 s cooldown and the palace-proximity rule are unchanged. Multiplayer human-vs-human stays disabled. |
| Initial civilization relation | The last spawn starts at war, as the old affinity under 35 always produced. Others start at peace. |

### 4.9 Worked examples (these are Rust unit tests in section 12)

1. **Peaceful capital, sole city, no trade.** `0.55·100 + 15 = 70`. The start value of 75 drifts to 70. Adding a monument and two advanced buildings gives 90.
2. **Second city 30 tiles from the capital.** Support is `12 − 10·0.6 = 6`, so the target is 76. With a domestic caravan saturating near `R ≈ 20`, the target is 96.
3. **Isolated outpost 60 tiles away, four raiders 6 tiles off for 3 minutes.** Support is −12, giving a base of 58. `w = 0.8` and `P = 4·0.8·1.25 = 4`. After 180 s, `E ≈ 8.65`, so `H ≈ 42.5` and `T ≈ 15.5`: warning. The rate is about −0.24/s, roughly 5 minutes from 75 to 0. A guard post and a tower (`Prot = 0.15`) give `H ≈ 36` and `T ≈ 22`. Killing the raiders lets `E` halve every 3 minutes.
4. **Kin village (A 0.55), allied with you, two caravans.** `30 + R≈22 + 10 = 62`. A stage-2 village with one guard post has `I = 78`, so acceptance needs 68: refused. After about 15 minutes of alliance, `A → 0.70` and the value is 70.5: accepted. Alternatively, a raid that lifts `H` to 30 drops `I` to 48, so acceptance needs 60. Defending the village during the raid adds up to +12 protector credit.

### 4.10 Constants (`affiliation.rs`, exported in this order)

| # | Name | Value |
|---|---|---|
| 0 | SENSE_INTERVAL | 1.0 s |
| 1 | INTEGRATE_INTERVAL | 5.0 s |
| 2 | CITY_SENSE_RADIUS | 14 |
| 3 | VILLAGE_SENSE_RADIUS | 12 |
| 4 | CORE_RADIUS | 4 |
| 5 | EXPOSURE_HALF_LIFE | 180 s |
| 6 | EXPOSURE_SCALE | 3.0 |
| 7 | THREAT_MAX | 45 |
| 8 | FEAR_MAX | 30 |
| 9 | INTIMIDATION_WEIGHT | 0.25 |
| 10 | CASUALTY_EXPOSURE | 1.5 |
| 11 | PROTECTION_CAP | 0.6 |
| 12 | PROTECTOR_HALF_LIFE | 300 s |
| 13 | PROTECTOR_MAX | 12 |
| 14 | TRADE_HALF_LIFE | 240 s |
| 15 | TRADE_SCALE | 40 |
| 16 | TRADE_MAX | 25 |
| 17 | CULTURE_WEIGHT | 0.55 |
| 18 | GOVERNANCE_BASE | 15 |
| 19 | ALLIANCE_BONUS | 10 |
| 20 | WAR_CAP | 20 |
| 21 | SNUB | 5 (half-life 120 s) |
| 22 | LOYALTY_START | 75 |
| 23 | LOYALTY_GRACE | 120 s |
| 24 | ASSIMILATION_TIME | 1200 s |
| 25 | CONFEDERATION_MIN | 60 |
| 26 | CONFEDERATION_MARGIN | 10 |
| 27 | PETITION_MIN | 80 |
| 28 | VILLAGE_TRADE_COST | 250 |
| 29 | VILLAGE_ALLIANCE_COST | 3000 |
| 30 | VILLAGE_ALLIANCE_MIN_COST | 500 |

### 4.11 Update cadence

| Work | Clock | Bound |
|---|---|---|
| Census maintenance | On actor publish or remove (existing movement events) | O(1) per change |
| Presence sensing, exposure, protector credit, village hostile lists | 1 Hz, global | ≤ 16 sectors per settlement. Members visited only in non-empty sectors. |
| Targets, values, assimilation, decay, warnings, secession, petitions, village base income | 5 s, global | 16 slots × settlements |
| Civic reassignment | On settlement set revision | O(civic × settlements of the same owner) |
| Village stage check, growth requests | 90 s per village, phase = `(villageId·17) mod 90` | ≤ 1 group request per village, ≤ 4 outstanding requests globally |
| Village recruitment | 90 s per village (existing) | 1 villager and 1 guard per tick |
| Adoption scan | 60 s per village, phase = `(villageId·7) mod 60` | Sector scan within 40 tiles |
| AI village diplomacy | 90 s per AI faction, phase by faction id | One action per faction per tick |
| Publication | After any system changes a row | Changed rows only. A value change is published if \|Δv\| ≥ 0.05 or flags, stage or relations change. |

The TS call site is `runRecurringWork(state, 'settlements', dt, elapsed => settlementStep(state))`. It replaces both `runRecurringWork('villages')` and `updateCityLoyalty` in `stepGame`, in the same position. Rust clocks decide what runs.

---

## 5. Rust modules and schedule

New files:

- `rust/src/affiliation.rs`: pure functions and constants (section 4), with no ECS. Heavily unit-tested.
- `rust/src/village_plan.rs`: template constants (section 8.3), parsing, the 8 transforms, fit scoring, family choice, slot lists with alternates, claim cells.
- `rust/src/settlement.rs`: `SettlementEngine` (World, Schedule, buffers, FFI-facing methods) and `Engines` (handle map), plus the systems:

Ordered schedule (`SingleThreadedExecutor`, `.chain()`):

1. `apply_inbox`: drain host events in arrival order. Covers upserts and removals of settlements and civic rows, trade, casualties, build results, transfer commits, civilization relation and faction rows.
2. `reassign_civic`: only when `settlement_revision` changed. Otherwise counters were updated in `apply_inbox`.
3. `refresh_hostility`: only when relations changed. Rebuilds the N×N matrix (6.4) and bumps `hostility_revision`.
4. `sense_presence`: when `now ≥ next_sense_at`. Takes `&movement::Engine` through a non-ECS resource pointer set for the duration of the step (section 6.1).
5. `integrate_affiliation`: when `now ≥ next_integrate_at`.
6. `village_economy`: base income on integrate ticks. `VILLAGE_BASE_INCOME = 0.06` gold/s.
7. `village_stage`: per-village growth clock.
8. `village_adoption`: per-village adoption clock.
9. `village_growth`: emits build requests.
10. `village_recruit`: emits spawn rows.
11. `ai_village_diplomacy`: emits commands and charges for AI civilizations.
12. `publish`: writes the Outbox into contiguous `Vec<f64>` buffers.

Iteration order is always by settlement id ascending, using a maintained `Rows` resource of entities sorted by id, as in `population.rs`. Archetype order never decides outcomes.

---

## 6. FFI surface

All exports are `#[unsafe(no_mangle)] pub extern "C"` in `lib.rs`, backed by a new `static SETTLEMENTS: RefCell<settlement::Engines>`. `simulation_abi_version()` becomes `2`, and `rust-engine.ts` checks for 2.

### 6.1 Lifecycle and step

| Export | Notes |
|---|---|
| `settlement_constant(index) -> f64` | Constants from 4.10 and the strides below (indices 100+) |
| `settlement_create(width, height, seed_hash: f64) -> u32` | One per `GameState` |
| `settlement_drop(handle)` | Called from a FinalizationRegistry |
| `settlement_step(handle, now, movement_handle) -> *const f64` | `lib.rs` borrows `MOVEMENT` immutably and `SETTLEMENTS` mutably: `MOVEMENT.with_borrow(\|m\| SETTLEMENTS.with_borrow_mut(\|s\| s.get_mut(h).step(now, m.get(mh))))`. Returns the Outbox header. If `movement_handle == 0`, as in fixtures without a movement world, sensing is skipped and presence keeps its last sample. |

Outbox header, 8 doubles: `[changedCount, eventCount, requestCount, spawnCount, chargeCount, hostilityRevision, claimRevisionMax, reserved]`. Section pointers come from `settlement_outbox(handle, section) -> *const f64`. Copy every section into host arrays before calling any other export, per the README rule. Renew typed views on memory growth, as `unit-health.ts` does.

### 6.2 Inputs (batched buffers; host fills, then commits)

| Export | Row stride and layout |
|---|---|
| `settlement_factions_input(handle, count) -> *mut f64`, `settlement_factions_commit(handle, count)` | **8**: `[id, civIndex(−1), flags(1 defeated, 2 human, 4 village, 8 confederated), gold, population, villageId(−1), relationToPlayer(0 self, 1 peace, 2 war, 3 confederated), 0]`. Sent at every step (fewer than 24 rows). |
| `settlement_civ_war(handle, a, b, war)` | Scalar, called on civilization relation change (diplomacyAction war or confederate, multiplayer setup). Also seeded at import. |
| `settlement_upsert_input(handle, count) -> *mut f64`, `settlement_upsert_commit(handle, count)` | **10**: `[id, kind(1 city, 2 village, 3 seceded), owner, x, y, population, heritageCiv, villageId, identity, flags(1 ready, 2 removed)]`. Sent on palace or hub add, remove, ready, or owner change, and for population (batched once per economy tick). |
| `settlement_civic_input(handle, count) -> *mut f64`, `settlement_civic_commit(handle, count)` | **8**: `[buildingId, kindCode, faction, x, y, w, h, flags(1 ready, 2 removed, 4 villageOwned)]`. Only for civic kinds (house, well, guardPost, woodenTower, tower, fort, monument, library, blacksmith, archeryRange, stable, scoutLodge, healerShack, dock, supplyDepot, palace, villageTent, road). Village roads are included so claims stay exact. Published from an entity-store building observer and coalesced per frame. |
| `settlement_trade(handle, settlementId, otherSettlementId, faction, partnerFaction, gold, kind)` | Scalar, once per delivery. Kind is 1 village, 2 domestic, or 3 inter-civilization. |
| `settlement_casualty(handle, settlementId, attackerFaction, population)` | Scalar, once per counted civilian death |
| `settlement_build_results_input(handle, count) -> *mut f64`, `..._commit(handle, count)` | **4**: `[requestId, ok, buildingId, reason(0 ok, 1 blocked, 2 transient, 3 territory, 4 unreachable, 5 terrain)]` |
| `settlement_plan_input(handle) -> *mut f64` | 25×25 = 625 cells of patch codes (section 8.4) |

### 6.3 Outputs (Outbox sections)

| Section | Stride and layout |
|---|---|
| 0 changed settlements | **12**: `[id, owner, loyalty, target, ratePerSecond, flags(1 warning, 2 grace, 4 secedePending, 8 petitionOpen), stage, family, independence, villageTreasury, claimRevision, topForeignFaction]` |
| 1 events | **4**: `[code, settlementId, faction, arg]`. Codes: 1 SECEDE, 2 PETITION(faction), 3 STAGE(arg = stage), 4 ADOPTED(arg = kindCode, faction = source), 5 VILLAGE_RELATION(faction, arg = relation), 6 AI_CONFEDERATE_VILLAGE(faction), 7 SLOT_SKIPPED(arg = slot) (debug only). |
| 2 build requests | **10**: `[requestId, villageId, kindCode, x, y, w, h, groupId, cost, houseLevel]`. Rows sharing `groupId` are validated together, all or nothing. `kindCode` 255 means an upgrade, where `houseLevel` is the target level and `(x,y)` is the house. |
| 3 spawns | **6**: `[villageId, role(1 villager, 2 guard), attack, homeBuildingId, cost, guardPostId]` |
| 4 charges | **4**: `[factionId, gold, category(1 diplomacy), reason]`. AI civilization spending, applied by the host with `spendGold`. |

### 6.4 Queries (on demand; UI or hot-path views)

| Export | Returns |
|---|---|
| `settlement_hostility(handle) -> *const f64` | `[n, ids[n], bits[n·n]]`. The host rebuilds the `Uint8Array` view only when `hostilityRevision` changes. `atWar` reads it for any pair involving a village faction or `-2`. Rule: same as today's `villageHostility`, evaluated in Rust from the civilization war matrix, village relations, the ally, and the multiplayer human set. |
| `settlement_village_relations(handle, villageId) -> *const f64` | `[relation per slot (16), tradingMask, alliedFaction(−1)]` |
| `settlement_breakdown(handle, settlementId, faction) -> *const f64` | **12**: `[value, target, rate, culture, trade, alliance, protector, fear, threat, governance, snub, independence]` (popup and panel only) |
| `settlement_village_status(handle, villageId, faction, gold, reachFlags) -> *const f64` | **4 actions × 3** `[available, reasonCode, cost]` for trade, ally, confederate and war, then `[acceptThreshold, value, relation, trading, cooldownUntil, tribute]` |
| `settlement_village_command(handle, villageId, faction, action, gold, reachFlags) -> *const f64` | `[ok, reasonCode, cost, outcome(1 done, 2 accepted-pending-transfer, 3 refused)]`. Trade, ally and war mutate immediately. Confederate returns outcome 2 without mutating ownership (7.1). |
| `settlement_civ_confederate(handle, target, requester) -> *const f64` | `[accepted, warDeclared, chancePercent]` |
| `settlement_commit_transfer(handle, oldId, newId, newOwner, kind, flags)` | Called by the host after executing a transfer. Rekeys, sets the owner, initializes affiliation (4.6), and clears pending flags. |
| `settlement_claim(handle, villageId) -> *const f64` | `[count, cell indices…]`, read when `claimRevision` changes |
| `settlement_village_hostiles(handle, villageId) -> *const f64` | `[count, unit ids…]` (≤ 8), updated at 1 Hz |
| `settlement_village_bonuses(handle) -> *const f64` | Rows of `[faction, food, trade, construction, research]` (replaces `refreshVillageBonuses`) |
| `settlement_plan_choose(handle, villageId, centerX, centerY) -> *const f64` | Uses the patch from `settlement_plan_input`. Returns `[ok, family, transform, lotX, lotY, hubX, hubY, tent1X, tent1Y, tent2X, tent2Y]` in world coordinates. |
| `settlement_export(handle) -> *const f64`, `settlement_export_len(handle) -> u32`, `settlement_import_input(handle, len) -> *mut f64`, `settlement_import_commit(handle)` | Snapshot (section 9) |

Reason codes are mapped to Pixel Operator UI strings in `src/ui/village-diplomacy.ts`. The same table is used by multiplayer command errors.

---

## 7. Diplomacy, confederation request flow and UI

### 7.1 Command path (single-player and multiplayer)

The existing `sendCommand({type:'diplomacy', faction, action, buildingId})` and `diplomacyAction(state, factionId, action, buildingId)` entry points are kept. For a village faction, `diplomacyAction` does the following:
1. Revalidate the visible representative and Leader reach exactly as today.
2. Call `settlement_village_command`. Reach flags: 1 means the Leader is within 3 tiles of the camp, and 2 means a remote negotiation through a visible representative. Both are host-measured, the same as today.
3. Apply the host effects for the outcome:
   - Trade, ally or war: `spendGold(cost, 'diplomacy')`, then refresh the trade routes, fog and bonus views. This is the same as today, but the decision came from Rust.
   - Confederate accepted: execute `confederateVillage` (7.5). Only if it succeeds, call `spendGold(tribute)` and `settlement_commit_transfer`. If the host transfer fails (for example the civic lot is blocked by a foreign building), return `{ ok: false, message: 'The village green is blocked.' }` with no charge and no Rust mutation.
   - Confederate refused: Rust has already applied the snub and a 90 s cooldown. Return the refusal message with no charge.

### 7.2 Request rules

- **Availability**: allied with the viewer, not at war, not on cooldown, Leader reach as for trade and alliance, and gold ≥ tribute.
- **Tribute**: `150 + 25·villagers + 100·stage` gold.
- **Acceptance**: deterministic, `v(v,f) ≥ max(60, I(v) − 10)`. The popup shows the exact threshold, so there is no hidden roll.
- **Refusal**: snub +5 to `S(v,f)`, cooldown 90 s, no charge.

### 7.3 Petitions

When the petition condition (4.8) holds, Rust emits `PETITION(village, f)` and sets `petitionOpen` for 120 s.
- **Human faction**: the event is logged as "Sabine Grove asks to join your realm." with a **Review** action that opens the village popup. The popup then shows **Accept petition** (tribute 0), which uses the same command path with action `acceptPetition`.
- **AI faction**: `ai_village_diplomacy` accepts automatically.

### 7.4 AI civilizations and villages (moves from `trade.ts`)

`ai_village_diplomacy`, run every 90 s per non-human civilization faction in faction id order:
1. **Trade**: the existing rule. Population ≥ 20, gold ≥ 1250, no current village trade partner, the closest reachable village not hostile. Reachability stays a host check: Rust emits the candidate list in distance order, and the host calls `tradeConnection` and confirms the first reachable one with `settlement_village_command`. The candidate list is at most 4 rows.
2. **Alliance**: when `v ≥ 55` and gold ≥ cost + 1500.
3. **Confederation**: when allied, accepted by the rule, and gold ≥ tribute + 1000. Emits `AI_CONFEDERATE_VILLAGE`, and the host executes the same transfer.

Charges go out as Outbox rows.

### 7.5 Ownership transfers (host effects; `src/game/settlement-transfer.ts`)

One module replaces `city-secession.ts` and the confederation block in `simulation.ts`. Each function only executes a transfer Rust already decided.

- `secedeCity(state, palace)`: today's body, unchanged in effect: a new white faction, the village row, buildings, citizens, fields, events. It calls `settlement_commit_transfer(palace.id, palace.id, newFaction, kind = 3)`.
- `captureSecededCity(state, formerFaction, palace)`: today's `finishSecededCityCapture`, then a commit with `v = 60`.
- `confederateVillage(state, village, faction)`:
  1. Units standing on the 2×2 civic lot step to the nearest `constructionEdges` exit.
  2. Validate the lot with `validatePhysicalFootprint(state, 'palace', lotX, lotY, faction)` (8.5). On failure, abort.
  3. Remove the hub and any remaining `villageTent`.
  4. Add a palace (`palaceLevel 1`, `cityName = village.name`, complete, `villageIdentity = village.identity`) and run `addPalaceRoadRing`.
  5. Every building with `villageId === village.id` gets `faction = f`, `delete villageId`, and `applyDefenseResearch`.
  6. Villagers become workers (home = palace). Guards become `militia` with `guardCity = palace.id`.
  7. `f.population += villagers`. The village treasury is granted to `f` as `'transfers'` (read from the view). The village faction is marked `defeated`, and `village.destroyed = true` with `confederatedInto = palace.id`.
  8. Then `invalidateCityTransfer`, the same invalidation set as today.
- `confederateCivilization(state, factionId)`: the existing `diplomacyAction` confederate body, moved verbatim. It then commits each city of the joining faction to the player, keeping heritage, with `v = max(v, 60)` and grace 120.
- **Identity bonus after confederation**: Rust's bonus rows count allied living villages *and* confederated cities that have `villageIdentity` and are owned by the faction. Same-identity bonuses still do not stack.

### 7.6 UI (Pixel Operator throughout; reuse existing dialog CSS; no new icon art required)

**Village popup** (`src/ui/village-diplomacy.ts`, moved out of `main.ts`):

```
Sabine Grove                                   Seed keepers
Village · stage 3 of 5 · Roadside layout
Affiliation with you   64 / 100   (+0.4 / min)
  Culture +30 · Trade +14 · Alliance +10 · Protection +6 · Fear 0 · Snub 0
Independence           71 / 100
Next stage: Large village — villagers 9 / 11 · about 4 min
Adopted: Library (from Roma) · Blacksmith (from Greeks)
[existing village trade comparison block]
[Establish trade · 250] [Form alliance · 2,450] [Request confederation · 525] [Declare war] [Cancel]
Confederation: accepts at 61 or more (independence 71 − 10). You have 64.
```

- Disabled buttons carry the reason string as the `title`, as today.
- After a refusal, the result line reads "Sabine Grove refuses for now. Ask again in 90 seconds."
- A petition replaces the request button with **Accept petition · free**.

**City panel** (`building-activity.ts`): `Loyalty 64/100 · −3/min`, with a factor line `Culture +55 · Governance +27 · Trade +12 · Threat −30 (protected 20%)`. The warning pulse (`loyaltyPanelAlpha`) and the ribbon wreath number read from the view.

**Civilization diplomacy popup** (`showDiplomacy`): `Affiliation 58%` replaces `Affinity`. `Confederate · N%` uses `chancePercent` from a dry-run status query. Add `settlement_civ_confederate_status` returning `[chancePercent]`, sharing the formula.

**Events**: stage advance ("Sabine Grove has grown into a village.") and adoption ("Sabine Grove built a library, learned from Roma.") are logged only when the village is explored by the viewer. Petitions are always logged.

**Village hover tooltip**: name, stage, and affiliation with you.

Any button icon added later must be generated with imagegen or PixelLab, per AGENTS.md. This design adds none.

---

## 8. Village evolution

### 8.1 Stages and gates

All conditions in a row must hold to advance. Rust checks them on the village growth clock.

| Stage | Name | Min age since founding | Min villagers | Previous-stage slots built or skipped | Adoption cap | House level target |
|---|---|---|---|---|---|---|
| 0 | Camp | — | — | — | 0 | 1 (tents) |
| 1 | Hamlet | 300 s | 4 | 100% of stage 0 | 0 | 1 |
| 2 | Village | 900 s | 7 | ≥ 80% of stage 1 | 1 | 2 |
| 3 | Large village | 1500 s | 11 | ≥ 80% of stage 2 | 2 | 3 (converts the 2 non-hub tents) |
| 4 | Town | 2400 s | 15 | ≥ 80% of stage 3 | 4 | 3 |

- Villager cap: `min(28, 5 + Σ houseLevel)`.
- Guard cap: `min(12, 2 + floor(houses/2) + 3·guardPosts)` (unchanged).
- Recruitment: one villager and, if affordable, one guard per 90 s (unchanged cost 40).
- Spending: from the Rust village treasury only.

Costs (village treasury): road 3 per cell, house 40, house upgrade to level 2 for 50 and to level 3 for 100, well 30, guard post 120, wooden tower 100, adopted building 150 (library 200, monument 250), dock 120, guard 40.

Income: base `0.06` gold/s, plus trade receipts (4.2). With no trade, a village reaches stage 2 in about 20 to 25 minutes. A trading village is gated by the stage clocks. Seceded cities do not run layout evolution: their family is `none` and they keep their city structures. They do run affiliation, diplomacy and confederation.

### 8.2 Growth step (every 90 s per village)

Priority:
1. Check whether the stage advances. If so, emit `STAGE`, and re-arm skipped slots of earlier stages once (`status 2 → 0`).
2. Upgrade the lowest-id house below the stage target level, if affordable. This emits an upgrade request (kindCode 255), which the host applies with `advanceHouseUpgrade`.
3. Convert a tent at stage ≥ 3: a tent slot becomes a house in the same cell. The host removes the tent and places the house in one effect.
4. Take the next pending slot of stage ≤ current, in template order, whose kind is *eligible*:
   - Tower slots need `woodenTower` adopted (8.7). Otherwise they are deferred and retried at the next tick.
   - Adoption lots need an assigned adopted kind.
   - The quay needs `dock` adopted.
   - Houses are requested by **group**: all cells sharing a group letter form one atomic request.
   - Roads are requested as runs of up to 4 contiguous cells.
5. The request is charged on success only. Rust reserves the cost while the request is outstanding, so the treasury cannot double-spend.

Failure handling (deterministic):
- **Transient** (reason 2, a unit standing on the cell): keep the slot pending and retry the next tick, up to 5 times, then treat it as blocked.
- **Blocked, territory, unreachable or terrain**: try the slot's alternates in order. For 1×1 slots, the alternates are the two template-empty cells adjacent along the frontage road axis. Groups shift ±1 along the axis. 2×2 lots have no alternates. When the alternates are exhausted, mark the slot `skipped`. A skipped road cell also skips every later road cell of that branch and any house group whose only frontage was on it (precomputed dependency list per slot).

### 8.3 Layout families

The template frame puts the civic lot `P` at local `(0,0)–(1,1)`, with x east and y south. Each family is a pair of ASCII layers that port directly into `village_plan.rs` as `const` string arrays: a **kind layer** (the stage-4 appearance) and a **stage layer** (the stage at which each cell is first built). Founding tents show as `h` with stage `0`. They are tents until stage 3, then houses. The hub `H` stays until confederation.

Legend:

| Symbol | Meaning |
|---|---|
| `P` | Civic lot. Reserved and kept empty. Becomes the palace on confederation. |
| `H` | Hub tent |
| `=` | Road |
| `h` | House |
| `W` | House plus well. The well is added at `max(2, house stage)` and shares the tile, per `canShareHouseWellTile`. |
| `G` | Guard post |
| `T` | Wooden tower |
| `A` `B` `C` `D` | Adoption lots in order (2×2) |
| `Q` | Riverside quay (dock only) |
| `~` | Expected water |

All four templates were checked with a prototype validator (kept at `scripts/village-templates-check.mjs` in the implementation phase; its logic is specified in 12.1):
- no overlaps except well-on-house and tent-to-house;
- every road cell is 4-connected to the civic lot at every stage;
- every house, lot, guard post, tent and quay has road or lot frontage at its own stage;
- riverside structures stay off the water rows, and the bank row holds only the quay and towers.

**Family 1: Roadside (linear street village).** For long open ground. The spine runs through the frontage of the civic lot. House pairs face both sides, a short side lane appears at stage 4, and towers stand at the spine ends.

```
stage 0                  stage 1                  stage 2                  stage 3                  stage 4
..........PP..........   ..........PP..........   ..........PP...AA.....   ..BB......PP...AA.....   ..BB......PP...AA.....
.........HPPt.........   .......hhHPPt.........   .....G.hhHPPtWhAA.....   ..BB.G.hhHPPhWhAAhhT..   T.BB.G.hhHPPhWhAAhhT..
......................   .......========.......   ....==============....   ..==================..   ======================
..........t...........   ..........thh.........   .......hh.thh.........   .......hh.hhh.hh.G....   ..DDhh.hh.hhh=hh.GCC.T
......................   ......................   ......................   ......................   ..DD.........=....CC..
......................   ......................   ......................   ......................   ............h=h.......
......................   ......................   ......................   ......................   ............h=h.......
kind layer               stage layer   (lot origin: column 10, row 0)
..BB......PP...AA.....   ..33......00...22.....
T.BB.G.hhHPPhWhAAhhT..   4.33.2.1100002222333..
======================   4433222111111112223344
..DDhh.hh.hhh=hh.GCC.T   ..4444.22.011433.344.4
..DD.........=....CC..   ..44.........4....44..
............h=h.......   ............444.......
............h=h.......   ............444.......
```

The two tents in row 1 and row 3 of the stage-0 sketch show as `t`. Per stage: houses 0/4/8/14/20, roads 0/8/14/18/26, guard posts 0/0/1/2/2, towers 0/0/0/1/3, lots 0/0/1/2/4. The extent is 11 tiles from the lot along the axis and 6 across it.

**Family 2: Market cross (pinwheel crossroads).** For open ground in all four directions. A road ring hugs the civic lot, and four offset arms form a pinwheel. Three-house L-clusters sit in the quadrants, adoption lots nestle between arms, and towers stand at the arm tips.

```
stage 0            stage 1            stage 2            stage 3            stage 4
................   ................   ................   ................   .......=........
................   ................   ................   .......=T.......   .......=T.......
................   ................   ................   .......=h.......   .......=h.......
................   ................   ......h=........   ......h=h.......   ......h=h.......
................   ................   ......h=..AA....   ......h=h.AA....   ......h=h.AA....
......H..t......   ......H==t......   ......H==tAA....   ......H==hAA....   ......H==hAAhh..
.......PP.......   ....hh=PP.......   ....hh=PP===....   ....hh=PP=====..   ..hhhh=PP======T
.......PP.......   ....===PP.......   ....===PP=.G....   ..=====PP=.G....   T======PP=.G....
.........t......   ......===t......   ......===t......   ..hhBB===h......   DDhhBB===h......
................   ......hh=.......   ......hW=h......   ....BBhW=h......   DD..BBhW=h......
................   .......h=.......   .......h=h......   .......h=h......   .......h=h......
................   ................   ................   .......G=.......   .......G=CC.....
................   ................   ................   ........=.......   .......h=CC.....
................   ................   ................   ................   .......h=.......
................   ................   ................   ................   ........T.......
kind layer         stage layer   (lot origin: column 7, row 6)
.......=........   .......4........
.......=T.......   .......33.......
.......=h.......   .......33.......
......h=h.......   ......223.......
......h=h.AA....   ......223.22....
......H==hAAhh..   ......01102244..
..hhhh=PP======T   ..44111002223344
T======PP=.G....   4433111002.2....
DDhhBB===h......   4433331110......
DD..BBhW=h......   44..331112......
.......h=h......   .......112......
.......G=CC.....   .......3344.....
.......h=CC.....   .......4344.....
.......h=.......   .......44.......
........T.......   ........4.......
```

Per stage: houses 0/5/9/16/22, roads 0/11/17/25/29, guard posts 0/0/1/2/2, towers 0/0/0/1/4, lots 0/0/1/2/4. The extent is 8 in every direction.

**Family 3: Riverside (waterfront promenade).** Requires water within 6 tiles of the center. The template is oriented so its `~` rows face the water. The bank row stays open except for the quay `Q` (dock adoption only) and the end towers. The promenade road runs one row inland. House pairs face the water, with two inland lanes and backland lots.

```
stage 0                  stage 1                  stage 2                  stage 3                  stage 4
~~~~~~~~~~~~~~~~~~~~~~   ~~~~~~~~~~~~~~~~~~~~~~   ~~~~~~~~~~~~~~~~~~~~~~   ~~~~~~~~~~~~~~~~~~~~~~   ~~~~~~~~~~~~~~~~~~~~~~
......................   ......................   ............Q.........   ............Q......T..   T...........Q......T.T
......................   .......=========......   ...===============....   .===================..   ======================
.........HPPtt........   .......hhHPPtth.......   ...Ghh.hWHPPtth=hh....   ...Ghh=hWHPPhhh=hhhh..   .hhGhh=hWHPPhhh=hhhhG.
..........PP..........   ..........PP..........   ..........PP...=AA....   ....BB=h..PP..h=AA....   ....BB=h..PP..h=AA....
......................   ......................   ...............=AA....   ....BB=h......h=AA....   ....BB=h......h=AA....
......................   ......................   ......................   ..............h=......   ....DD=.......h=h.....
......................   ......................   ......................   ......................   ....DD=.......h=h.....
......................   ......................   ......................   ......................   ..............h=CC....
......................   ......................   ......................   ......................   ................CC....
kind layer               stage layer   (lot origin: column 10, row 3)
~~~~~~~~~~~~~~~~~~~~~~   ......................
T...........Q......T.T   4...........2......3.4
======================   4332222111111111223344
.hhGhh=hWHPPhhh=hhhhG.   .44222311000001222334.
....BB=h..PP..h=AA....   ....3333..00..3222....
....BB=h......h=AA....   ....3333......3222....
....DD=.......h=h.....   ....444.......334.....
....DD=.......h=h.....   ....444.......444.....
..............h=CC....   ..............4444....
................CC....   ................44....
```

Bank following, which keeps the layout deterministic: real rivers are not straight. Before fitting, compute the water distance transform on the patch, a 4-connected BFS from water cells. For each template column, shift the whole column vertically by the offset (|offset| ≤ 2, and adjacent columns differ by at most 1) that puts the promenade cell at water distance 2. Where adjacent column offsets differ, insert one connecting road cell, the "step" in the promenade, in the higher column. This is a pure function of the patch.

Per stage: houses 0/3/7/16/22, roads 0/9/18/26/33, guard posts 0/0/1/1/2, towers 0/0/0/1/3, lots 0/0/1/2/4, quay from stage 2.

**Family 4: Hill cluster (Haufendorf).** For rough ground with ridge edges or high elevation variance. A ring lane hugs the lot, bending spurs climb onto terraces, and irregular three- or four-house clusters sit on the terraces. During fitting, each house group must lie on a single ridge level (`ridgeFootprintAllowed`, using the per-cell level in the patch). A group that straddles levels takes its alternates.

```
stage 0           stage 1           stage 2           stage 3           stage 4
...............   ...............   ...............   ...............   ..h=h..........
...............   ...............   ...............   ....hh......T..   .Th=hh......T..
...............   ...............   .......AA.h=...   ...====AA.h=...   ...====AA.h===.
...............   ...............   .......AA.h=h..   ...hh.=AA.h=h..   ...hh.=AA.h=hCC
...............   ...............   ......======h..   ......======h..   ......======hCC
.....H.PP......   .....H=PP=.....   .....H=PP=.....   .....H=PP=.....   .....H=PP=.....
.......PP.t....   ......=PP=t....   ......=PP=t....   ......=PP=h....   ......=PP=h....
...............   ......====.....   .....G====.....   .....G======h..   .....G======h..
........t......   .....h=ht......   .....W=ht......   .....W=hh.h=h..   DD...W=hh.h=h.T
...............   ....===h.......   ....===h.......   ....===h.BB=...   DD=====h.BB===h
...............   ....hh.........   ....hh.........   ....hh...BB....   ..G.hh...BB.hh.
kind layer        stage layer   (lot origin: column 7, row 5)
..h=h..........   ..444..........
.Th=hh......T..   .44433......3..
...====AA.h===.   ...333322.2244.
...hh.=AA.h=hCC   ...33.322.22244
......======hCC   ......222222244
.....H=PP=.....   .....01001.....
......=PP=h....   ......10010....
.....G======h..   .....21111333..
DD...W=hh.h=h.T   44...1110.333.4
DD=====h.BB===h   44441111.333444
..G.hh...BB.hh.   ..4.11...33.44.
```

Per stage: houses 0/5/9/18/24, roads 0/12/20/29/37, guard posts 0/0/1/1/2, towers 0/0/0/1/3, lots 0/0/1/2/4.

Template order inside a stage, which is the request order: roads in BFS order from the lot (ties broken by template row, then column), then house groups by group letter, then the well, guard posts, adoption lots and towers. Group letters are stored in a third layer (`group`) in `village_plan.rs`. Every `h` cell belongs to the group of its 4-connected `h` neighbors placed in the same stage. Single houses form their own group.

### 8.4 Family and orientation choice (founding)

Founding stays in TS world creation (`initializeVillages`), which samples candidate points with `state.rngState` as today. For each candidate:
1. The host encodes a 25×25 patch centered on the candidate into `settlement_plan_input`, one f64 per cell:
   - bit 1: open land (passes today's `usable` rule, with no unit check);
   - bit 2: water;
   - bit 4: ford;
   - bit 8: blocked (resource footprint, cliff face, existing building, field, or another faction's territory);
   - bit 16: clearable vegetation (forest, jungle, swamp overlay);
   - bits 8–11 of the integer part shifted by 8: ridge level 0–15.
2. `settlement_plan_choose` evaluates 4 families × 8 transforms (4 rotations × mirror):
   - **Hard requirements**: the lot, hub and both tents fall on open land, and the hub has a walkable door. The host still checks `hasStaticPath` from some palace exit to the door after choosing, as today.
   - **Fit score**: `Σ_slots weight(stage)·valid(cell)`, with weights 4/3/2/1/1 for stages 1–4 and 0. A slot is valid if every cell is open land or clearable vegetation, and for the quay, if it is land with a 4-neighbor water cell.
   - **Riverside**: eligible only if ≥ 70% of `~` cells are water. Its fit is multiplied by 1.5.
   - **Hill cluster**: multiplied by 1.4 if ≥ 12% of patch cells are ridge edges (adjacent cells with different ridge levels) or the ridge-level standard deviation is ≥ 0.6.
   - **Roadside**: multiplied by 1.2 if the longest open straight run through the center, along either axis, is ≥ 17 cells.
   - **Market cross**: ×1.0.
   - The best score wins. Ties go to the lower `hash(seed, villageId, family, transform)`.
3. The host places the three tents at the returned cells and stores nothing else. Rust keeps `family`, `transform` and the lot origin in `VillageState`.

If no family passes the hard requirements, the candidate is rejected and sampling continues, as today with the `tents` check.

### 8.5 Placement through existing validation (TS host effect)

Refactor `validateBuildCellAt` in `simulation.ts` into two parts:
- `validatePhysicalFootprint(state, kind, x, y, faction, reserved)`, exported from a new `src/game/placement-physical.ts`. It covers: resource footprint, berth, dock placement, forbidden zones (for the given faction), permanent fort, hermits, ford roads, bridge rules, ridge footprint, dry land, irrigation water, the occupancy and layering rules (gate, irrigation, house and well, wall and tower, replaceable road), fields and pending fields, farm-relocation planning for roads, walls and buildings, and the palace, fort, archery range and library 2×2 clearance.
- The faction-only checks stay in `validateBuildCellAt`: leader distance, own-border rule, library-per-city, well population, research unlock, iron, cost, and road continuity.

`validateBuildCellAt` calls `validatePhysicalFootprint` first, so player and AI behavior is unchanged.

`src/game/village-sites.ts` exports `applyVillageRequests(state, rows)`. For each request group in Outbox order:
1. For every cell, call `validatePhysicalFootprint(state, kind, x, y, village.faction, groupCells)`.
2. Village rules:
   - No cell may have `territoryValue` owner ≥ 0 other than the village faction. Village claim cells are owned by the village.
   - Roads: the first cell must touch the civic lot or an existing village road. Later cells in the run must touch the previous cell. This is the village equivalent of `hasNeighboringRoad`. A template road cell on a ford counts as built with no building added.
   - Reachability: the existing `developmentSites` rule. Run `createReachabilityQuery` from the hub door with the whole group blocked. Every existing village building and every proposed footprint must keep a reachable `constructionEdges` cell.
3. On success, place the buildings complete using today's `addBuilding` semantics: `villageId`, faction, hp table, `houseLevel` and `houseStyle` via `advanceHouseUpgrade` to the requested level, and `dockBoatLaunched = true` so a village dock never launches a boat. Clear the overlay and palm, call `removeVillageTrailAt` for roads, and call `markWorldChanged` (structure or sight) and `invalidateNavigation` once per group.
4. Write the result row (6.2).

Results are committed at the end of the same `settlementStep`, so Rust sees them on the next step.

Spawn rows are applied by `spawnVillageUnits(state, rows)`, which is today's `addVillager` with the stats from the row. Guard attack is 16, or 20 when `blacksmith` is adopted.

### 8.6 Village claim (territory)

The claim is the union of:
- a disk of radius 3 around the lot center;
- every cell within Chebyshev distance 1 of a built village structure, roads included;
- every cell of pending slots of the current stage (a reservation, so neighbors cannot take land the village is developing).

Rust recomputes it on any slot status change or stage change, bumps `claimRevision`, and the host reads `settlement_claim`. `borders.ts` drops `villageRadius` and `villageBorderRadius` and passes these cells as `VillageClaim.cells`, the existing field already used by seceded cities. Placement and border rules that use `buildingOverlapsVillageBorders` keep working unchanged.

### 8.7 Adopting nearby faction buildings

Adoptable kinds, each with a minimum stage and a slot type:

| Kind | Min stage | Slot | Village effect before confederation |
|---|---|---|---|
| woodenTower | 3 | tower slots | Enables tower slots (combat as today) |
| library | 2 | lot (2×2) | +5 independence |
| blacksmith | 2 | lot (cell touching the frontage road) | Guards spawn with attack 20 |
| healerShack | 2 | lot | Village units regenerate at ×1.5 (health engine multiplier input) |
| dock | 2 | quay (riverside only) | Cosmetic. No boat. |
| monument | 3 | lot | +5 independence. No culture. |
| scoutLodge | 3 | lot | Cosmetic |
| stable | 3 | lot | Cosmetic |
| archeryRange | 3 | lot (the 2×1 row touching the road) | Cosmetic |

Never adopted: fort, supplyDepot, palace, walls, palisade, irrigation, farms, ballista, observationPost and bridge. Guard posts and wells are native village tradition.

Influence, computed every 60 s per village from `CivicIndex` sectors within 40 tiles of the lot center:

```
Inf(v,K) = Σ_{b ready, kind K, owner is a target faction, d ≤ 40} (1 − d/40)·(0.5 + v(v, owner(b))/100)
```

A kind is adopted when `Inf ≥ 0.6`, the village stage ≥ the kind's min stage, and the number of adopted lot kinds is below the stage's adoption cap (8.1). `woodenTower` and `dock` do not use lots and are not capped. Candidates are ranked by `Inf`, highest first, then by kind code. The source faction is recorded as the owner contributing the most to `Inf`, which feeds the `ADOPTED` event text. Adoption is permanent. The next free lot in A, B, C, D order is assigned. Its build request is issued on later growth ticks, like any slot.

Example: a friendly faction (v = 60) has one library 15 tiles away. `Inf = 0.625·1.1 = 0.69`, so the library is adopted at stage 2.

**Inertness audit.** Village-owned buildings must not trigger faction systems. Add a `building.villageId !== undefined` early return or skip in each of:
- `research.ts` (library count and research progress);
- `archery.ts` and `scheduleArcheryTraining`;
- `cavalry.ts` and stable recruitment;
- `scouts.ts` and lodge spawns;
- `healer-shack.ts` (faction healing query; village regen uses the multiplier path instead);
- `blacksmith.ts` (equipment research);
- `dock.ts` (launch, also guarded by `dockBoatLaunched`);
- `culture.ts` (already excludes village factions; assert it in a test);
- `borders.ts` (base radii for house and monument must not create civilization claims for village buildings);
- `maintenance.ts` (no upkeep);
- `building-activity.ts` panels (village buildings open the village popup, as tents do);
- `faction-development.ts` and `governor.ts` (already skip village factions; assert).

After confederation, `villageId` is deleted and the buildings become ordinary faction buildings.

### 8.8 Determinism

- Templates are static. The transform comes from patch, seed and village id.
- Slot order is fixed, and requests are emitted in village-id order with a global FIFO bound of 4 outstanding.
- Validation outcomes depend only on simulation state.
- No `Math.random`, wall clock or archetype order is involved. The only RNG is the saved `Rng` resource, used only for civilization confederation.

Test: two runs from the same seed produce identical village building lists (kind, x, y, stage) at t = 2400 s.

### 8.9 Village unit behavior (stays TS until the movement migration)

`updateVillageUnit` keeps its wander and defend logic. It replaces `nearbyThreats(...)`, a whole-unit filter every 0.5 s per village, with `villageHostilesView(state, village)` from `settlement_village_hostiles`, refreshed at 1 Hz. The existing per-unit `valid()` and `orders.visible()` checks remain. To keep the "two-tile buffer" behavior, the Rust hostile list uses `R + 2` for villages.

---

## 9. Save format

- `GAME_SAVE_VERSION` goes from 6 to **7**. Old saves are rejected by the existing version check, as allowed by AGENTS.md.
- New field `GameState.settlementCore?: string`: base64 of the `Float64Array` returned by `settlement_export`.
- Layout, versioned by a leading `[magic 0x5E77, formatVersion 1]`:
  - header `[now, nextSenseAt, lastSensedAt, nextIntegrateAt, lastIntegratedAt, rngHi, rngLo, factionCount, settlementCount]`;
  - faction slot table rows `[id, slot, civ]`;
  - the civilization war matrix as a bitset, packed into f64s 52 bits at a time;
  - per settlement, a fixed head (Settlement, Heritage, VillageState scalars) followed by a **sparse** slot list `[slotCount, (slot, value, target, alignment, tradeVolume, exposure, protector, snub)…]`, where a slot is omitted when value, exposure, volume, protector and snub are all 0 and alignment equals base;
  - plan arrays `[slotCount, status…, alternates…]`, adoption, lot assignments and petition state.
- The expected size is under 30 KB for 60 settlements.
- **Flush point**: `serializeGameSave` and `serializeGameSaveAsync` call `flushSettlementSnapshot(state)` inside `assembleSave`, at the same instant the dynamic state is stringified. This preserves the ordering guarantee of the async save.
- **Import**: `parseGameSave`, then `migrateGame`, which already rebuilds derived state at load, then `importSettlementSnapshot(state)` at the point where `migrateGame` calls `refreshVillageBonuses` today. That function creates the engine, imports the snapshot, re-sends faction rows, civilization war pairs, settlement upserts and civic rows (the host entity state is authoritative for those), and runs one `settlement_step` with no elapsed time to publish views. Missing `settlementCore` (fresh worlds, fixtures) initializes from the host rows with initial values (4.6).
- **Removed saved fields**: `Building.loyalty`; `Faction.affinity`; `GameState.nextLoyaltyAt` and `loyaltyUpdatedAt`; `NeutralVillage.relation`, `relationsByFaction`, `alliedFaction`, `trading`, `tradingFactions`, `nextTradeAt`, `tradeGoldByFaction`, `nextGrowthAt`, `nextThinkAt` and `nextRecruitAt`.
- **Added**: `NeutralVillage.confederatedInto?: number`, `Building.villageIdentity?: VillageIdentity` (palaces).

---

## 10. Performance

- **Removed costs**:
  - `nearbyThreats`: an all-units filter per village every 0.5 s (about 9 villages × 2 Hz × N units).
  - `updateVillages`: `state.buildings.filter` and `state.units.filter` per village every 0.5 s.
  - `loyaltyBorderPressure`: a full border-edge pass with nearest-city lookups every 5 s.
  - `updateCityLoyalty`: an all-buildings pass every 5 s.
- **Added costs**:
  - Census maintenance is O(1) per actor sector change.
  - Sensing touches about 60 settlements × at most 16 sectors at 1 Hz.
  - Integration covers 60 × 16 slots every 5 s.
  - Adoption covers about 9 villages × at most 121 sectors per minute.
  - Placement validation handles at most 4 requests per step, typically one group per village per 90 s, at the same cost as today's `developmentSites`.
- **Budget assertion** (performance test, 12.3): with 60 settlements and 2000 units, the mean `settlement_step` time including the bridge is ≤ 0.3 ms per call over 600 simulated seconds. No per-frame Rust call is made other than the recurring-work step.

---

## 11. Migration list (TS deleted or replaced)

| File | Change |
|---|---|
| `src/game/loyalty.ts` | **Delete.** Replaced by Rust `integrate_affiliation` and `sense_presence`. `recordLoyaltyCasualty` becomes `settlementCasualty` (bridge). |
| `src/game/loyalty-model.ts` | **Delete.** Constants come from `settlement_constant`. `loyaltyWarning` and `loyaltyPanelAlpha` move to `settlement-view.ts` and read view flags. |
| `src/game/loyalty-art.ts` | Keep (wreath art). |
| `src/game/city-secession.ts` | **Replace** with `settlement-transfer.ts` (host effects only). `hasSecededCity` moves there unchanged. |
| `src/game/village-relations.ts` | **Delete.** Replaced by `villageRelationView` and `villageAllyView`. |
| `src/game/villages.ts` | **Shrink.** Keep `VILLAGE_IDENTITIES` (UI text), `villageCamp`, `villageForBuilding`, `villageRequiredResource`, `initializeVillages` (now calling `settlement_plan_choose`) and `updateVillageUnit` (hostiles from the view). **Delete** `VILLAGE_TRADE_*` costs (Rust), `GROWTH`, `VILLAGE_DEVELOPMENT_COSTS`, `VILLAGE_MAX_GUARDS`, `developmentSites`, `developVillage`, `updateVillages`, `villageTradeActive` (becomes a view), `villageAllianceCost`, `recordVillageTrade`, `villageHostility` (becomes the hostility view), `villageDiplomacyStatus` and `performVillageAction` (become Rust status and command plus UI formatting), `refreshVillageBonuses` (becomes a bonus view), `nearbyThreats`, `random`, `usable` (moves to the founding patch encoder) and `openNear` (moves to `village-sites.ts`). |
| `src/game/simulation.ts` | Remove the loyalty imports. Replace `updateCityLoyalty` and `runRecurringWork('villages')` with `runRecurringWork('settlements')`. Route casualty hooks (lines ~1223–1225) to `settlementCasualty` with the attacker faction. Remove the affinity generation from `createGame` (last spawn starts at war). In `diplomacyAction`, the village branch goes to Rust commands and the civilization confederate branch goes to `settlement_civ_confederate` plus `confederateCivilization`. Split `validateBuildCellAt` into physical and faction parts. `refreshVillageBonuses` at load becomes `importSettlementSnapshot`. |
| `src/game/trade.ts` | **Delete** `establishFactionVillageTrade` (Rust AI). `finishDelivery` calls `settlementTrade` for village, domestic and inter-civilization legs, and stops calling `recordVillageTrade`. Village trade activity uses the view. |
| `src/game/relations.ts` | `atWar` uses the hostility view for village and `-2` pairs. |
| `src/game/borders.ts` | Remove `villageRadius` and `villageBorderRadius`. Village claims use cells from the view. |
| `src/game/types.ts` | Remove `CityLoyalty`, `Building.loyalty`, `Faction.affinity`, `nextLoyaltyAt`, `loyaltyUpdatedAt` and the NeutralVillage relation and clock fields. Add `settlementCore`, `confederatedInto` and `villageIdentity`. |
| `src/game/game-save.ts` | Version 7, flush hook. |
| `src/main.ts` | Remove `showDiplomacy`'s affinity math. `showVillageDiplomacy` moves to `src/ui/village-diplomacy.ts`. Add petition review handling and a refusal message. |
| `src/ui/building-activity.ts`, `src/game/city-ribbon.ts`, `src/game/renderer.ts` | Loyalty number, rate, warning and factors come from `settlement-view.ts`. |
| `src/ui/action-tooltips.ts` | Guard post: "Protects nearby people; reduces loyalty loss from threats." Monument: "Expands borders with culture and adds 12 loyalty; one loyalty bonus per city." (unchanged) |
| `combat-feedback.ts`, `forbidden-zones.ts`, `hit-testing.ts`, `raid-targeting.ts`, `building-interaction-highlight.ts`, `faction-trade-agreements.ts` | Replace direct reads of village relation fields with view helpers. |
| `src/game/rust-engine.ts` | Add the settlement exports to `RustExports`. ABI 2. |
| `rust/MIGRATION.md`, `rust/README.md` | Add the `settlement.rs` authority (cities, villages, diplomacy, evolution) and the census note in `movement.rs`. Move "research/culture/loyalty, trade" partially to Integrated. |
| New files | `rust/src/{affiliation,village_plan,settlement}.rs`; `src/game/{settlement-bridge,settlement-view,settlement-transfer,village-sites,placement-physical}.ts`; `src/ui/village-diplomacy.ts`; Storybook files (section 13). |

---

## 12. Test plan

### 12.1 Rust (`npm run test:rust`)

`affiliation.rs`:
- `own_capital_targets_seventy`, `second_city_support`, `isolated_raided_outpost_warns_and_falls_within_five_to_six_minutes` (4.9 example 3, integrated at 5 s steps).
- `exposure_rewards_proximity_and_frequency`: one unit at 2 tiles for 60 s equals about 4 units at 11.5 tiles. Repeated short visits accumulate. Half-life decay is exact.
- `protection_caps_at_sixty_percent`, `guard_posts_only_matter_under_threat`.
- `trade_saturates_and_decays_with_half_life`, `snub_decays`.
- `assimilation_requires_loyalty_fifty`, `allied_village_alignment_caps_at_seventy`.
- `grace_blocks_only_negative_rates`, `elapsed_is_chunked_not_lost` (a 30 s gap gives six integrations).
- `family_alignment_table_is_symmetric`.

`movement.rs` census:
- `census_tracks_move_remove_faction_kind_inside_and_death`.
- `census_query_matches_bruteforce`: 500 random actors with deterministic SplitMix, 50 random rectangles, compared against brute force.

`village_plan.rs`:
- `templates_parse_with_equal_layers`.
- `no_overlaps_except_well_and_tent_conversion`.
- `roads_connected_to_lot_at_every_stage`.
- `every_building_has_frontage_at_its_stage`.
- `riverside_bank_row_reserved`.
- `transforms_preserve_validity` (all 8).
- `choice_is_deterministic_and_seed_sensitive`.
- `riverside_requires_water`, `hill_prefers_ridges`.
- `bank_following_offsets_are_smooth`.
- `claim_contains_built_and_pending_current_stage`.

These encode the validator used to check the ASCII in 8.3. Port it from the scratch prototype as `scripts/village-templates-check.mjs` for quick review.

`settlement.rs`:
- `secession_emits_once_and_waits_for_commit`.
- `village_status_reasons` for each action.
- `confederation_threshold_exact` (accepts at 60 / I−10 boundaries, refuses below).
- `refusal_sets_cooldown_and_snub_without_charge`.
- `petition_requires_sustained_condition_and_rate_limit`.
- `stage_gates_require_age_population_and_completion`.
- `growth_requests_are_bounded_and_ordered`.
- `failed_slot_uses_alternates_then_skips_dependents`.
- `transient_failures_retry_five_times`.
- `adoption_threshold_caps_and_persistence`.
- `dock_only_with_quay`.
- `towers_wait_for_woodenTower_adoption`.
- `treasury_never_double_spends_outstanding_requests`.
- `ai_trade_alliance_confederation_order`.
- `hostility_matches_legacy_rules` (table-driven from today's `villageHostility` cases).
- `export_import_round_trip_is_bit_exact`.
- `continuation_after_import_matches_uninterrupted_run` (run 300 steps against export at 150, then import and continue; compare all Outbox rows).

### 12.2 TypeScript (targeted `npx vitest run --dir tests <name>`)

Rewritten or updated:
- `loyalty.test.ts`: peaceful capital stays ≥ 70. An isolated, raided city warns, then secedes after several minutes through the scheduled step. Casualties from any hostile attacker count. Domestic trade raises loyalty. A guard post reduces loss only under threat. Secession and reconquest keep today's transfer assertions.
- `villages.test.ts`: founding chooses a family and transform. Tents sit on the template cells. Determinism per seed holds. Relations, trade, alliance and war go through the command path (costs 250 and 3000, trade discount floor 500 unchanged). Hostility parity holds, including "allied villages fight the player's enemies" and "independent villagers do not provoke raiders".
- `village-development.test.ts` becomes `village-evolution.test.ts`:
  - stage gates;
  - real placement through `validatePhysicalFootprint`, never in forbidden zones, fields, fords (roads become built), foreign territory or water;
  - house groups are atomic, and the reachability rule keeps the camp and buildings reachable;
  - upgrades follow stage;
  - tents convert at stage 3;
  - same-seed determinism at 2400 s;
  - no charge for failed sites.
- `village-adoption.test.ts`: a nearby library adopts at stage 2 and never above cap. Village-owned adopted buildings are inert (the audit list in 8.7 is asserted by running the faction systems one tick each and observing no research progress, training, boats, culture, upkeep or claims).
- `village-confederation.test.ts`:
  - the status threshold text matches Rust;
  - accepted requests charge the tribute once, place a palace on the lot, and convert villagers to workers and guards to militia;
  - the identity bonus persists;
  - a blocked lot fails with no charge;
  - refusal triggers the cooldown;
  - petition review and accept work;
  - the second multiplayer faction can negotiate;
  - an AI civilization confederates a village through the host transfer.
- `war-declaration.test.ts`: civilization confederation chance uses faction-level affiliation. Village actions are not civilization confederation.
- `village-trade.test.ts`, `village-trade-quote.test.ts`, `village-bonuses.test.ts`, `village-borders.test.ts`, `neutral-village-raiders.test.ts`, `gold-transactions.test.ts`, `cities.test.ts`, `faction-strategy.test.ts`: replace field reads with view helpers. Claims use cells. Village income is base plus trade.
- `settlement-bridge.test.ts`: strides from constants; changed-row publication only; view renewal after WASM memory growth (force a grow between step and read); snapshot flush happens inside `assembleSave`.
- `game-save.test.ts`: v7 round trip mid-evolution with an outstanding request, a petition open and a seceded city. Loaded play continues identically to an unsaved control for 300 s.

### 12.3 Performance

`settlement-performance.test.ts` (headless) uses the 60 settlements / 2000 units fixture to assert the budget in section 10, and asserts `settlement_step` is called at most once per recurring-work pulse. A counter spy confirms no TS code iterates all units for village threats.

### 12.4 Final pass

One full `vitest run` and `npm run test:rust` at the end of implementation, per the workflow. A browser playtest happens only if requested. The existing MIGRATION.md requirement for an eventual playtest still applies.

---

## 13. Storybook plan

Storybook is not installed today. There is no `.storybook` and no dependency, and the visual reviews under `dev/*` are standalone labs. Add it as follows:

- **Dependencies**: `storybook` and `@storybook/html-vite`, pinned to an exact 8.6.x patch at least two weeks old. Add scripts `"storybook": "storybook dev -p 6006"` and `"build-storybook": "storybook build -o output/storybook"`.
- **`.storybook/main.ts`**: framework `@storybook/html-vite`, stories glob `stories/**/*.stories.ts`, `staticDirs: ['../public']` so `wasm/simulation.wasm` and the art resolve at `BASE_URL`.
- **`.storybook/preview.ts`**: await `loadGameFonts()` (Pixel Operator) and the asset loaders used by `main.ts` (`renderer.initialize()`, palace sprite, wooden building art, village art). Set the body font to Pixel Operator.

**Fixture**: `stories/fixtures/village-evolution.ts` exports `buildVillageEvolutionState(family, seconds)`:
- **World**: a hand-built 56×44 world for each family, built like the test fixtures. Roadside and Market cross use flat grassland with scattered forest. Riverside has a meandering 3-wide river along the north, built with real `WATER` terrain and ford cells. Hill cluster has two ridge levels and a cliff edge.
- **Factions**: the player (Roma), plus a neighbor civilization (Greeks) with a completed palace 24 tiles away, and a library, blacksmith, well, monument, wooden tower and (riverside) dock. These drive adoption.
- **Village**: founded through the real `initializeVillages` placement path, with the family forced by a fixture-only `forceFamily` argument on `settlement_plan_choose`. This is a debug flag constant, documented and excluded from gameplay builds through a `#[cfg(feature = "fixtures")]` export. Alternatively, pick a seed that selects the family naturally; prefer this if achievable.
- **Advance**: deterministic. Repeatedly call the real `settlementStep(state)` plus `applyVillageRequests` and `spawnVillageUnits` at 1 s increments of `state.time`, with a scripted trade receipt of 30 gold every 60 s through `settlement_trade` from the player. Movement and units are not simulated (`movement_handle 0`, so threat stays 0). This runs the real Rust evolution and the real TS placement validation.

**Timesteps**: `t = 0 s`, `420 s`, `1000 s`, `1650 s` and `2600 s`. These sit just past each stage gate (stage 0 through 4), assuming the scripted income. The fixture asserts that the reached stage equals the expected one and throws otherwise, so a balance change that shifts gates fails loudly.

**Rendering**: the real `Renderer` from `src/game/renderer.ts`:
- `new Renderer(canvas, minimap)`, then `await initialize()`;
- `follow = false`, zoom 3, camera centered on the lot;
- fog fully explored for the player (set the discovered and visible arrays the way `scripts/house-wells-check.mjs` does);
- `renderer.draw(state, 0)`.

WebGL context limits forbid five renderers on one page, so a "strip" story uses one renderer offscreen. It renders each timestep, copies the result into its own 2D canvas with `drawImage`, then advances. Labels under each frame, such as "Stage 2 · 17 min", use Pixel Operator.

**Stories** (`stories/village-evolution.stories.ts`):
- `Roadside`, `MarketCross`, `Riverside`, `HillCluster`. Each has a `timestep` arg (0–4, control: inline radio) and renders one frame.
- `RoadsideStrip`, `MarketCrossStrip`, `RiversideStrip`, `HillClusterStrip`. Each shows five frames side by side, which covers the TODO requirement "each layout at 5 timesteps".
- `Gallery`: all 20 frames as a 4×5 grid.

**Automated check**: `scripts/check-village-evolution-stories.mjs` (Playwright) builds Storybook, opens the 4 strip stories, and saves 20 PNGs to `output/village-evolution/`. It asserts each frame is non-blank, that consecutive frames differ (pixel diff > 1%), and that the fixture's stage assertions passed (no console errors).

No new art is needed. Every building kind shown already has game sprites. If a Storybook-only UI chip or icon is wanted later, generate it with imagegen.

---

## 14. Implementation order

1. Rust `affiliation.rs` with its unit tests. Then the `movement.rs` census with tests.
2. `settlement.rs` for cities only: sensing, integration, secession, casualty and trade inputs, export and import. Then the bridge, views, `settlement-transfer.ts` (secede and capture), save v7, and UI loyalty readouts. Delete `loyalty.ts`, `loyalty-model.ts` and `city-secession.ts`. Run targeted tests: loyalty, cities, game-save, settlement-bridge.
3. Village relations, diplomacy, trade ledger, hostility matrix, bonuses and AI village diplomacy moved to Rust. Then the village popup UI. Run targeted village-trade, villages, war-declaration, village-bonuses and neutral-village-raiders tests.
4. Confederation: village request, petition, civilization confederation and transfers. Remove `affinity`. Run village-confederation and war-declaration.
5. Evolution: `village_plan.rs`, founding choice, growth, adoption, `placement-physical.ts` refactor, `village-sites.ts`, claims and the inertness audit. Run village-evolution, village-adoption, village-borders and any construction tests touched by the validation split (`construction-*.test.ts`, `building-on-roads.test.ts`, `border-placement.test.ts`).
6. Storybook and the story check script.
7. Update `rust/MIGRATION.md` and `rust/README.md`. Run the single final full test pass.

---

## 15. Decisions taken (defaults) and alternatives

| Decision | Default chosen | Alternative |
|---|---|---|
| Defection of cities directly to a rival with higher affiliation | **Not in v1.** Cities secede to independence, and the independent settlement can later confederate with anyone. | Add an `EVENT_DEFECT` when `max_f v(s,f) ≥ v(s,owner) + 25` and loyalty < 30 for 60 s. |
| Village confederation outcome | Deterministic threshold, shown in the UI | A probabilistic roll like civilizations (rejected: opaque, and harder to test) |
| Untraded villages grow | Yes, with 0.06 gold/s base income | Trade-only (today). This would stall evolution, which contradicts the TODO. |
| Guard posts in loyalty | Only through protection under threat | Keep +3 flat. This would double count protection. |
| Village placement | Instant completion (today's behavior) | Construction sites with a timer. Better visuals, but villages have no builders. Revisit with the construction migration. |
| Civilization relations | Stay TS-owned and pushed into Rust | Move civilization diplomacy fully into Rust when the strategic AI migrates |
| Storybook fixture family forcing | A natural seed per family, with a `fixtures` cargo feature as fallback | Always force. This is simpler but adds a debug export. |
