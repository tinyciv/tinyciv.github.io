# Naval combat

Shipyards occupy 3×3 map cells (96×96 rendered pixels; 48×48 source art). Sailing unlocks them. Placement requires a completed friendly city with at least 100 residents, one shipyard per city, dry clear land, friendly borders, a builder route and at least one edge adjacent to navigable coastal water. Rivers and lakes do not qualify. Construction costs 500 gold and takes 90 seconds.

Each shipyard builds and supports one warship. A ship costs 500 gold, takes 30 seconds to finish and includes eight marines. Its first 30 seconds of service are included; subsequent service costs 50 gold every 30 seconds. Unpaid service reduces speed to 40% and disables weapons until the next paid service interval. Upkeep consumes available gold without creating debt.

An anchored warship repairs its hull at 2.4 HP per second within three tiles of any completed shipyard owned by its faction. Range is measured from the physical hull to the shipyard footprint; the nearby-yard check runs once per second. Repairing ships show the existing pulsing green healing cross above their nameplate. Warships do not also receive ordinary land-unit regeneration.

| Ship | Research | Weapon mounts | Top speed | Hull health |
| --- | --- | ---: | ---: | ---: |
| War galley | Sailing | 2 | 2.7 tiles/s | 900 |
| Caravel | Lateen Sails | 3 | 3.105 tiles/s | 1,100 |
| Frigate | Naval Engineering | 4 | 3.57075 tiles/s | 1,400 |

Lateen Sails requires Sailing and Engineering. Naval Engineering requires Lateen Sails and Metal Casting. The frigate's 15% speed increase is relative to the caravel. Every hull occupies a 2×5 capsule with 2×4 usable deck space. Steering turns at 0.32 radians/s, compared with the existing galley's 1.15. Reverse thrust reaches 45% of forward speed.

Choose mounts and marine equipment at the ship's own shipyard. Refits are free and preserve casualties. Weapon mounts accept ballistae (Siege Engines) or cannons (Siege Engines and Gunpowder), and can also be left empty. Marine choices are archers (Archery) and musketmen (Gunpowder).

Select an empty friendly ship and right-click it to board with the Leader. The current living retinue travels hidden aboard; its identity, equipment and squad veterancy remain intact. Marines remain visible. W/S apply forward/reverse thrust; A/D and Q/E turn. Right-click water to sail. An inspected friendly ship can also receive a water destination while the Leader remains ashore.

Within two tiles of a clear shore, slot **6** offers **Cast anchor** (then **Raise anchor**). Anchoring stops translation and turning. Slot **7**, **Go ashore**, lands the Leader and carried retinue and leaves the ship anchored. Any clear walkable land tile whose center is within two tiles of the physical hull is eligible, including elevated banks; clicking a land tile chooses that destination. The small Leader galley uses the same two-tile landing reach. Slot **8**, **Reinforce**, restores the ship's marine complement and issues the existing retinue recall/replacement workflow while the Leader is aboard or near its shore landing. When the Leader stays aboard an anchored ship, replacements walk to its landing and board automatically after Reinforce. Boarding again also carries the assembled retinue.

Marauder fleets use native 16×32 PixelLab barbarian galleys with a 1×2 physical hull. Each carries exactly one actual archer, drawn separately on deck. The native fleet budget is four to twelve boats according to the defending army, replacing the old multi-unit transports. Archers fire ordinary arrows from the boat and can land with their raid group; a sunk boat kills its embarked archer. Native acquisition runs once a second with independent reloads. Art provenance and the three grounded variants are in `public/assets/naval/barbarian-galley-source.json` and `scratch/2026-11-16-barbarian-galley/`.

Civilian rowboats show their occupants at 60% sprite scale. Their render anchor stays centered on the physical rowboat. Vessel visibility checks the entire hull, and rendering fades a last-observed pose with the fog's return animation instead of snapping off at the center tile. Hidden ships' current positions are never used for that fade.

Nearby hostile ships fight automatically. Each ballista, cannon and surviving marine acquires and tracks its own target once per second, retains its own cooldown and fires from its own deck position. Marines target the enemy crew first, then the hull. Mounts show their existing native siege aiming and recoil frames. Marines show their own firing poses. Two ship kills advance a ship's veterancy tier, up to Elite, and damage increases with its own kills. Boat labels show only a faction-appropriate name, without numeric suffixes. Veterancy remains saved on the individual ship.

Weapons and marines keep acquiring and firing at hostile ships and visible shore units with or without a Leader aboard. Landing the Leader and retinue preserves the ship's crew, mounts and independent weapon cooldowns.

Warships anticipate nearby warship traffic and brake/steer to avoid it. Collisions damage both ships in proportion to closing speed squared and the opposing hull's mass. Base damage is 35 × closing speed², scaled by the opposing maximum hull health / 900. A prow hit takes 30%, a stern hit 75%, and a broadside hit 135% of that damage. There is a 0.75-second repeat-impact cooldown. Manual forward movement can ram hostile ships; friendly traffic avoidance remains active. Sinking a warship awards 1,000 gold to the hostile faction credited with the final damaging hit. The final attacking ship receives the kill. A four-second hull-specific PixelLab sinking effect persists after the ship entity is removed. War galleys use a seven-frame oar rowing loop while moving. All carried units die when the hull sinks, including close to shore; ordinary Leader death and retinue casualty handling still apply.

Rival realms consider one city and one shipyard per second, reserve gold before naval purchases, and pursue hostile warships through the same native steering and combat rules.

## Implementation and art

- `rust/src/sim/warships.rs` contains the Bevy ship components and handles shipyard rules, controls, navigation, avoidance, collisions, embarking, firing, upkeep and rewards.
- `src/game/warships-native.ts`: command/data transport, serializable mirrors, existing construction/ledger/death effects and maintained terrain-blocker publication.
- `src/game/warship-art.ts` and `src/game/native-art.ts` draw the generated hull textures, continuous rotation, and upright marines with troop animations.
- `src/ui/shipyard-panel.ts`: ship, mount and marine choices; authenticated multiplayer commands use the same validation path.
- `public/assets/naval/warships/source.json`: PixelLab generation provenance. Native sprites are unmodified API outputs grounded in existing game art and approved mockup crops.
- `public/assets/ui/naval/source.json`: original imagegen UI icons, extracted from generated atlases without painting pixels.
- `scratch/2026-11-15-naval-combat-assets/index.html`: static asset review gallery; opening it does not run the game.

Target acquisition and strategic orders run once a second; route replanning is throttled and shares a bounded node budget. Ship collision candidates use native spatial buckets. Building blocker changes patch occupied cells; ordinary construction does not rebuild the full water grid. Full terrain reconstruction is reserved for first initialization or an unlocated terrain replacement. Placement previews import ship mirrors without advancing combat or billing upkeep.

The shipyard popup uses explicit mount and marine buttons in the shared Pixel Operator popup style. Its isolated component verification exercises native build/refit commands on all 2/3/4-slot classes, repeated draft refreshes, independent weapon/archer fire, and asymmetric ramming. No interactive game or full scenario warmup was started.

Scenarios use the ordinary geography/climate/river/ecology generator. Native site selection chooses natural founding locations; small ordinary settlements then grow through the existing economy, population, governor, courier and builder systems during asynchronous preparation. Rust decides when every founding city has at least 200 people, 200 housing and nonnegative food production. Starting fleets and frontier equipment use normal native placement and construction commands. Scenario populations can exceed 200 while slower cities catch up. The simulated age is retained so existing construction, harvest and upkeep deadlines stay coherent.
