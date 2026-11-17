# Cultural unlocks

Forums sell permanent faction achievements after Cultural Identity. The first
seven achievements lead to Redemption Arc. Three four-node branches then extend
the tree through depth 7; roots have depth 0. All three branches remain available
to the same faction, and purchases still count toward lifetime border culture.

| Depth | Cost | Unlock | Prerequisite | Bonus |
| --- | ---: | --- | --- | --- |
| 4 | 360 | Household Tradition | Redemption Arc | +25% population growth, with food and housing required |
| 4 | 360 | Customary Law | Redemption Arc | +4 owned-town loyalty target |
| 4 | 360 | Oaths of Service | Redemption Arc | +25% positive soldier morale recovery within owned borders |
| 5 | 520 | Inherited Craft | Household Tradition | +35% construction and repair speed |
| 5 | 520 | Secure Property | Customary Law | +35% gross town taxes |
| 5 | 520 | Code of Honor | Oaths of Service | +35% Leader and retinue defense within owned borders |
| 6 | 750 | Guild Charters | Inherited Craft | +50% base domestic trade gold |
| 6 | 750 | Local Liberties | Secure Property | Halves owned-town military threat penalties |
| 6 | 750 | Citizen Militia | Code of Honor | +50% militia attack and defense |
| 7 | 1,100 | Stewardship of the Land | Guild Charters | +65% base food yield for established orchards |
| 7 | 1,100 | Living Tradition | Local Liberties | +65% base town and monument culture |
| 7 | 1,100 | Defense of the Homeland | Citizen Militia | +65% defense damage within owned borders |

The branches emphasize inherited household skills and stewardship; customary law,
property, and local institutions; and reciprocal service and territorial defense.

## Rules and integration

- Rust owns prices, prerequisites, purchases, all bonus amounts, and combat and
  population arithmetic. TypeScript mirrors accounts, passes identity and
  location facts, and renders the tree with Pixel Operator and existing
  Imagegen glyphs. The achievement mask contains 19 bits.
- Cultural percentage bonuses add to the relevant existing multiplier. For
  example, Metal Tools (1.25) and Inherited Craft (+0.35) give 1.60 construction
  speed without other modifiers; a mature orchard's 1.50 yield becomes
  2.15 with Stewardship without other modifiers. Other modifiers that
  already exist are retained, with the cultural increment added to their
  combined multiplier. Culture from Creation Story and Living Tradition also
  adds to the local Colosseum multiplier.
- Household Tradition applies to both house and palace births. Native growth
  credit combines it additively with Colosseum and hunting growth bonuses, and
  scales the birth release allowance. Food costs, housing, and depopulation
  rules still apply. Enclosed homes retain their separate credit requirement.
- Customary Law contributes to governance before the ordinary loyalty target
  clamp. Local Liberties reduces the threat contribution, not hostile presence
  itself. Both appear in the existing affiliation breakdown and integrate at
  the settlement engine's existing cadence; villages gain neither effect.
- Secure Property increases gross taxes before upkeep and research allocation.
  Economy observers include achievement changes so cached city summaries and
  orchard projections update without adding scans to frame work.
- Guild Charters adds half the unmodified domestic receipt after the existing
  population curve and small-town cap. Foreign civilization and village trade
  receive no cultural increment. Leg quotes remain fixed at departure.
- Citizen Militia modifies the live militia stat calculation, including future
  recruits. Code of Honor modifies Leader and retinue defense only at home.
  Their increments add to equipment-based stats rather than multiplying
  equipment upgrades.
- Homeland damage applies to firing towers, Keeps, and forts, and to guard-post,
  fort, and city-garrison soldiers on home ground. Mobile siege engines and
  field retinues receive no Homeland damage bonus. Combat previews and hits
  share native rules; projectiles retain their launch damage.
- Morale recovery bonuses add together and never reduce morale losses or
  bypass rally conditions. Territory-dependent bonuses share a snapshot
  refreshed at most once per simulated second; actors read their current cell.
- Orchard bonuses apply after establishment. Existing harvested food and cargo
  are unchanged. Yield projections and governor estimates use the same bonus
  as new harvests. Inherited Craft retimes active construction at purchase.

## Validation

Use the normal production build to compile Rust/WASM, check TypeScript, and
bundle the UI. Tests and interactive playtests require an explicit request.
