# AI iteration 2 results

Completed 612 direct policy matches, 36 fixed-opponent runs, and 2 generated-world runs on one paired map. The iterative search explored three generations with nine automatic or submitted candidates.

## Independent field-combat confirmation

The four policies played a complete mirrored round robin on 24 new seeds, 240 seconds per match. Timeouts remain draws; wins require authoritative faction defeat.

| Policy | Wins | Draws | Losses | Points |
| --- | ---: | ---: | ---: | ---: |
| evolved-assault | 62 | 53 | 29 | 239 |
| field-concentration | 61 | 50 | 33 | 233 |
| hard-assault | 27 | 69 | 48 | 150 |
| expansionist | 19 | 66 | 59 | 123 |

| Candidate | Control | Wins / draws / losses | Positive / negative / tied seeds | Sign-test p | Passes corrected threshold |
| --- | --- | --- | --- | ---: | --- |
| evolved-assault | expansionist | 24 / 20 / 4 | 18 / 0 / 6 | 0.000003815 | true |
| evolved-assault | hard-assault | 21 / 21 / 6 | 12 / 1 / 11 | 0.001709 | true |
| field-concentration | expansionist | 21 / 18 / 9 | 11 / 1 / 12 | 0.003174 | true |
| field-concentration | hard-assault | 21 / 20 / 7 | 11 / 0 / 13 | 0.0004883 | true |

Both legs count as one observation per seed. The Bonferroni threshold is 0.0125, covering both finalists against both controls. Finalists and rules were fixed before this final seed family was run.

The recovery-rule ablation is inconclusive: evolved-assault versus field-concentration was 17 wins, 12 draws and 19 losses. Although evolved-assault ranked slightly higher across the full opponent pool, this does not establish that its recovery rule improves on the simpler army-concentration change.

## What changed

`field-concentration` extends the earlier hard-assault contender and assigns zero healthy soldiers to the standing home garrison. Wounded or unavailable troops still stay out of the field escort through the existing planner. It trades home defense for a larger local army.

`evolved-assault` adds a conditional recovery rule: Leader HP at least 70%, morale at least 60, and observed enemy power no greater than 1.1 times friendly power. It can resume fighting before returning within six tiles of home. The inherited hard-assault default required 90% HP, 75 morale, power ratio at most 0.6, and proximity to home. It retains formations and the ordinary planning cadence, commands, research, payment, and combat rules.

The initial screen rejected smaller formation thresholds and the more protective patient-pressure combination. The first evolutionary screening leader regressed on confirmation and was rejected. The recovery proposal led the later search but did not pass its per-generation promotion gate. It was exported for the separate independent comparison above.

## Transfer checks

Fortified matches: 36; actual defeats: 0; final siege engines summed over contestants: 0. This does not establish a siege-conquest improvement.

| Policy | Fixed-opponent runs | Leader survival | Mean kills | Mean diagnostic score |
| --- | ---: | ---: | ---: | ---: |
| evolved-assault | 9 | 1 | 17.11 | 321.35 |
| hard-assault | 9 | 1 | 16.56 | 317.35 |
| field-concentration | 9 | 1 | 16.44 | 316.47 |
| expansionist | 9 | 1 | 16.11 | 315.43 |

The fixed-opponent score weights survival, retinue HP, kills and palace damage. It is a diagnostic, separate from the authoritative match-victory rule.

## Generated-world case study

One default map was replayed with the same initial-state hash, with the selected policy assigned to every nonhuman rival. This is a paired case study of a generated world, not head-to-head self-play or a statistical claim about economic strength.

| Policy | Simulated seconds | Stop reason | Rival population | Ready cities | Ready forts | Ready siege engines | Rival territory |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| expansionist | 3600 | duration | 294.00 | 5 | 0 | 0 | 1876 |
| evolved-assault | 3600 | duration | 306.00 | 6 | 4 | 0 | 2297 |

## Reproduce and inspect

Definitions and commands: [experiment directory](../../experiments/ai-iteration-2/README.md). The [finalists file](../../experiments/ai-iteration-2/finalists.json) is usable directly with `--policy-file` and `--policies=evolved-assault` or `--policies=field-concentration`.

Reports: [independent raw matches](independent-final.json), [direct comparisons](independent-evidence.json), [evolution](evolution/README.md), [fixed opponents](transfer-ai.json), [fortified matches](fortified-transfer.json), [baseline world](world-expansionist.json), [candidate world](world-evolved-assault.json), [combined evidence](study-evidence.json).

- The initial 60-match hypothesis screen used an earlier engine and is not pooled with later evidence.
- The final comparison is controlled field combat; the fortified check and fixed-opponent scenarios are transfer diagnostics.
- Both starting sides are grouped by seed; four final candidate/control comparisons use alpha 0.0125 each.
- Generated-world results cover one paired map, and must not be treated as a population-wide economic or conquest result.
- The live default was not changed.
