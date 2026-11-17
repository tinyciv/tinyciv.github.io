# AI tournament: ai-tournament-2026-11-15

Champion on held-out seeds: **hard-assault**.
Completed 192 matches, including both starting sides for every pair/scenario/seed.

| Policy | Wins | Draws | Losses | Points |
| --- | ---: | ---: | ---: | ---: |
| hard-assault | 11 | 46 | 7 | 79 |
| expansionist | 9 | 46 | 9 | 73 |
| disciplined | 7 | 46 | 11 | 67 |

Screening: 4 seeds × field-battle, siege-war, 180s limit.
Validation: 8 fresh seeds × field-battle, siege-war, 240s limit.

The same frozen engine and WASM snapshot was used in both stages. Full resolved policy definitions, fixture hashes, raw outcomes, timings and artifact hashes are in the JSON reports.

- Controlled military fixtures with neutral observer and negotiations disabled; not a full generated-world campaign balance study.
- Mirrored legs share seeds and are correlated; raw match counts are not independent sample counts.
- Timeouts are draws. Ranking uses actual faction defeat, not damage or an invented timeout winner.

This experiment does not change the live default policy.

Reports: [screening](screening.json), [validation](validation.json), [combined analysis](experiment.json), [reproducibility plan](plan.json).

## Interpretation

Hard-assault ranked first in both stages, but its validation advantage over the live expansionist baseline was small: 5 wins, 7 draws and 4 losses in their 16 direct open-field matches. Grouping the two mirrored legs by seed leaves one seed-pair advantage and seven ties; none favored expansionist on aggregate points. This supports treating hard-assault as a candidate for more testing, not a proven general upgrade.

All 96 fortified matches across both stages timed out. No siege engines were present at the end of those matches and no starting Keep took damage. The experiment therefore did not establish a siege-conquest winner. Scheduled automatic retinue replenishment was suppressed in these controlled starting-army fixtures; normal purchases and other economic systems remained active. Longer generated-world campaigns with full recruitment are needed before drawing economic or siege-balance conclusions.

The formation-free variant lost all 24 open-field screening games and was eliminated. All winners were checked against the losing faction's authoritative defeated flag; timeout games remained draws. The validation seed family was disjoint from screening, and both stages used identical engine/WASM hashes. See [additional evidence](evidence.json) for direct baseline comparisons and seed-pair counts.

Reproduce the complete two-stage loop with:

```sh
npm run build:wasm
node tools/simulation-harness/experiment.mjs experiments/2026-11-15/experiment.json scratch/ai-experiment-repeat
```

Candidate definitions: [policies.json](../../experiments/2026-11-15/policies.json). The experiment plan is [experiment.json](../../experiments/2026-11-15/experiment.json).
