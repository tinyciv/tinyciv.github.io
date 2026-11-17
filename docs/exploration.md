# Wilderness encounters

New worlds place reachable, nonblocking 2×2 ancient ruins and 1×1 hermit huts
outside civilization borders and initial exploration. Each site receives one
of three seeded art variants, retained in saves. A living human Leader on
land triggers a site once by walking onto any footprint tile. Original treasure
chests and quest-giving hermits keep their existing behavior.

## Rewards

Ruins roll a 5% clan ambush; gold, technology, settlement and refugees each have
23.75% probability. Treasure is uniformly 100–300 gold in increments of ten.
Technology is the most expensive unfinished technology with all prerequisites
already learned, using current research prices. If all research is complete,
that result awards treasure instead.

The settlement popup uses the supplied story verbatim. Accepting replaces the
ruins with a completed town with ten residents and ten housing places, plus
free farms. That town's ordinary maintenance is doubled for 180 game seconds.
Tooltips on Accept/Leave explain the consequences. Closing the popup retains
the offer; clicking the ruins reopens it, and leaving the visit area rearms it.

The ambush spawns the current living retinue size plus three clan warriors in
a formation near the ruins. The clan first attacks the discovering Leader;
a rout, flee order, death, or separation of more than twelve tiles commits it
to that faction's original capital. Ordinary camp recall, casualty thresholds
and stalled-raid timers do not cancel this attack. All casualties or routing
ends its pursuit.

Refugees add ten residents and ten visible people departing the ruins toward
a reachable friendly town. Free houses and farms are placed near that town;
houses leave spaced lanes and preserve the arrival corridor. People use normal
movement and remain vulnerable during the journey. Their visible travel units
retire on arrival; the existing civilian job system represents settled workers.

Hermit huts roll 5% for 25 gold. Cartography, ranger and Leader level each have
31⅔% probability. Cartography maps up to 300 previously unexplored cells along
paths toward up to three distinct nearest undiscovered towns/camps, widening
the corridors if budget remains. This records map knowledge without granting
ongoing vision.

The ranger is an immutable archer specialty with +50% base range, +25% speed,
+25% melee flee radius and zero upkeep. Each award adds one permanent retinue
slot reserved for a ranger. Composition controls exclude these companions;
casualties are replaced on the normal recruitment clock. The ranger retains
the archer's attacks, equipment, art, health and respawn behavior.

All non-popup story messages use Pixel Operator at 12px, white at 78% initial
opacity, follow the Leader, and fade continuously over eight game seconds.

## Implementation and review

`rust/src/sim/exploration.rs` owns Bevy encounter components, indexed contact,
seeded placement/appearance, the authoritative game-RNG rolls, eligibility,
reward plans, cartography, ranger rules and pursuit decisions. Serializable
`GameState.explorationSites` mirrors restore native components on load. The
native game outbox publishes RNG changes. Routine contact shares the existing
three-Hz treasure scheduler and traverses crossed grid cells so fast movement
cannot skip a hut; broad terrain observations are imported only on
initialization/reward, with two-second retry spacing for temporarily blocked
rewards. Construction checks reserve unconsumed encounter footprints.

`src/game/exploration-native.ts` transports observations and applies native
entity patches through the existing simulation constructors. The popup command
validates ownership on the multiplayer authority. `exploration-content.ts`
contains the requested story text; `exploration-art.ts` shares text drawing
between the retained renderer and isolated preview.

Approved imagegen art is in `public/assets/exploration/`: three 32×32 ruin
sprites and three 16×16 huts. It was reduced from the generated appearance
sheet, not generated directly at native resolution. Exact source references,
prompt, finishing provenance and the labelled preview are preserved under
`scratch/2026-11-16-exploration/`. The preview uses actual production art,
popup markup and message painting without starting a game.

Validation for this change: Rust/WASM compilation, TypeScript checking, Vite
production build and isolated art/popup screenshot. No tests or playtest were
requested or run.
