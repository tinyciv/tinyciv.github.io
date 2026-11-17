# Iterative AI search

Status: complete. Completed 3/3 generations and 228 matches.
Experimental incumbent: **hard-assault**. Live game defaults are unchanged.

| Generation | Challenger | Promoted | Incumbent | Positive / negative / tied seeds |
| --- | --- | --- | --- | --- |
| 1 | evo-g1-c1 | false | hard-assault | 0 / 2 / 10 |
| 2 | evo-g2-c3 | false | hard-assault | 5 / 1 / 6 |
| 3 | evo-g2-c3 | false | hard-assault | 4 / 1 / 7 |

Victories require actual faction defeat. Each seed plays both sides; timeouts are draws. Promotion requires fresh-seed confirmation, a one-sided sign test with an alpha budget across generations, and no scenario regression. A search can finish without discovering an improvement.

These military fixtures do not establish long-world economic, city expansion or siege quality. Short runs can be entirely draws. Validate exported policies on longer world runs before adopting them.

See `candidates/` for rule trees, parameters, ancestry and hypotheses; `reports/` for raw matches; `state.json` for resumable optimizer state; `incumbent-policies.json` for a harness-ready export. The engine snapshot is frozen across generations and resumes.
