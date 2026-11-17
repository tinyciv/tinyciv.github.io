# AI iteration 2

This study follows the earlier hard-assault tournament and the experimental rule-search pipeline. It explores army concentration, formation retention, retreat thresholds, and conditional recovery rules. The live default remains unchanged.

Candidate hypotheses are in [hypotheses.md](hypotheses.md); the evolutionary plan is [search-plan.json](search-plan.json). Human rule proposals live under `proposals/`. The [confirmation protocol](confirmation-protocol.md) reserves fresh seeds for the final comparison. The final [policy file](finalists.json) includes the previous hard-assault contender, field-concentration, and the selected evolved-assault candidate.

```sh
npm run build:wasm
npm run ai:search -- experiments/ai-iteration-2/search-plan.json scratch/ai-iteration-2-repeat
```

The recorded study froze its engine after new workspace game code required a WASM rebuild. Its earlier exploratory screen is kept separate. Subsequent checks use that frozen engine, including when the workspace changes again:

```sh
node experiments/ai-iteration-2/run-frozen.mjs benchmarks/ai-iteration-2/evolution match \
  --policy-file=experiments/ai-iteration-2/finalists.json \
  --policies=expansionist,hard-assault,evolved-assault,field-concentration \
  --scenarios=field-battle --seconds=240 --seeds=24 \
  --seed=iteration-2-independent-final --jobs=4 --out=scratch/ai-iteration-2-confirmation-repeat.json
```

Raw results and the completed study report are under [benchmarks/ai-iteration-2](../../benchmarks/ai-iteration-2/). `analyze.mjs` checks authoritative defeat outcomes and computes comparisons with mirrored legs aggregated by seed. `confirm.mjs` records the final candidate selection before running its independent comparison; it deliberately refuses to overwrite an existing selection.
