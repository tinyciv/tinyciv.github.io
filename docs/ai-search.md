# Iterative AI experimentation

`ai:search` evolves both numeric policy settings and new conditional decision logic. Every candidate runs through the production Rust/WASM simulation without rendering. Node proposes and scores experiments; Rust owns gameplay decisions. The search never changes the live default automatically.

```sh
npm run build:wasm
npm run ai:search -- experiments/ai-search.json benchmarks/creative-ai-001
# Continue an interrupted search with the same settings and output directory
npm run ai:search -- experiments/ai-search.json benchmarks/creative-ai-001 --resume
```

The checked-in plan runs three generations of four proposals, screening on two seeds in open-field and fortified matches. Each challenger then faces the incumbent on eight fresh seeds, with longer matches. Plan budgets cap matches and elapsed wall time. The wall budget is checked between complete stages, so one stage may finish beyond it. A generation starts only when enough match budget remains for its full screening and confirmation. Increase `maxMatches` or `maxWallSeconds` in the plan to continue a budget-limited study with `--resume`; other settings and harness code must stay identical. Use a new directory to change the study design or engine.

`experiments/ai-search-smoke.json` exercises two generations with three-second fixtures. It demonstrates proposal/evaluation/checkpoint plumbing; its likely draws cannot establish better play. Run it with the same command and a separate output directory. No browser or rendered playtest is involved.

## What evolves

The automatic proposer alternates parameter-only, logic-only and mixed candidates. Parameters receive local or broad mutations within `bounds`; correlated recovery and formation thresholds are repaired. Optional `featureMutations` can name capability flags to toggle. `decisionInterval` is excluded from default mutation bounds to preserve the planning cadence.

Logic evolves as expression trees: structural insertion, deletion, subtree replacement, literal mutation, and crossover from another archived policy. Starting hypotheses combine known observations; descendants can create different branches and arithmetic rather than merely choose a named tactic. Default targets include retreat, hunt eligibility, campaign selection, army garrisons, housing priority and siege holds. `decisions` can narrow this set. The archive retains competitive policies and a parent selected for different measured outcomes (army survival, cities, forts, siege engines and population). When observed behaviors tie, the archive favors different decision programs. It remains available even when a candidate does not win confirmation, allowing further exploration of a tied idea. This diversity measure is only an exploration heuristic, never a victory condition.

The proposer is a local evolutionary algorithm. It does not call a language model, edit arbitrary Rust source, invent new observations, or add new game commands. To explore capabilities outside the decision vocabulary, extend the Rust planner and observation schema and begin a new study with the rebuilt engine.

## New decision rules

Any policy JSON can supply `logic` overrides, including variants used by the ordinary `sim ai`, `sim match` and `sim world` commands:

```json
{
  "version": 1,
  "policies": [{
    "id": "contextual-retreat",
    "extends": "expansionist",
    "logic": {
      "retreat": {
        "op": "or",
        "args": [
          { "op": "lt", "args": [
            { "fact": "hp" },
            { "op": "mul", "args": [{ "fact": "maxHp" }, { "parameter": "retreatHealth" }] }
          ] },
          { "op": "and", "args": [
            { "op": "gt", "args": [{ "fact": "enemyPower" }, { "fact": "friendlyPower" }] },
            { "op": "gt", "args": [{ "fact": "distanceHome" }, 5] }
          ] }
        ]
      }
    }
  }]
}
```

Expressions accept numeric/boolean literals, `{ "fact": "name" }`, `{ "parameter": "name" }`, and `{ "op": "name", "args": [...] }`. Operators are `add`, `sub`, `mul`, `div`, `min`, `max`, `lt`, `le`, `gt`, `ge`, `and`, `or`, `not`, `if`, `ceil`, and `floor`. `if` has three arguments (condition, then, else); `not`, `ceil` and `floor` have one; others have two. Zero is false and nonzero is true. Division by a denominator at most 1e-9 in magnitude returns zero. Branches are evaluated eagerly in a bounded stack machine. Nonfinite arithmetic falls back to the native default and records a fault; faulting candidates cannot be promoted. Legitimately infinite observations, such as unreachable travel estimates, use the native default without counting as an arithmetic fault.

The [decision schema](../src/game/faction-ai-logic-schema.json) lists available facts per decision and bytecode modes. Facts come from the planner's existing observations; programs cannot scan entities, pathfind, loop, read clocks, use random numbers, or access hidden enemy state. Programs have at most 64 instructions and a 16-value stack. Native validation rejects malformed programs before policy registration. Outputs are normalized by decision type: booleans, bounded counts, or bounded estimates. Normal purchase, research, resource and command validation still applies. Logic is inherited like other policy settings; `null` removes an inherited override. Programs persist in native game saves.

## Feeding in creative proposals

Set `proposalDirectory` to a directory relative to the repository. Before each generation the search reads `generation-N.json` once, snapshots accepted proposals, and evaluates them through the same pipeline. This provides a data interface for a person or an external proposal generator without executing untrusted code:

```json
{
  "version": 1,
  "proposals": [{
    "hypothesis": "Release the field army whenever a ready tower can defend home",
    "parameters": { "garrisonFraction": 0.05 },
    "logic": {
      "garrison": { "op": "if", "args": [
        { "op": "ge", "args": [{ "fact": "towers" }, 1] },
        0,
        { "op": "max", "args": [1, { "op": "mul", "args": [{ "fact": "army" }, 0.1] }] }
      ] }
    }
  }]
}
```

Use population >= 3 for submitted proposals: the first two slots always retain automatic parameter and logic exploration. Later slots take submitted proposals before automatic mixed proposals. Each submission overlays its selected archived parent. Rejected proposals and reasons appear in generation history; accepted definitions, parent IDs, hypotheses and genome hashes are under `candidates/`. Submissions must use existing parameters/features and valid decision expressions. Parameter mutation bounds control the automatic optimizer; native policy ranges validate all submissions.

## Evaluation and promotion

Screening is a full round robin of the baseline, incumbent, archive and proposals on the same fixtures and seeds. Every pairing plays both starting sides. Initial-state hashes must match. The top eligible challenger faces the incumbent on a disjoint confirmation seed family; seed families are also distinct between generations. Actual authoritative faction-defeat flags determine wins. Timeouts stay draws, with no invented winner from remaining hit points.

Both sides and all scenarios sharing a seed are aggregated into one observation. Promotion requires at least `promotion.minPositiveSeeds` positive seeds, more positive than negative seeds, no aggregate loss in any scenario, no logic faults, and a one-sided exact sign-test p-value below `promotion.alpha / generations`. This spends a fixed false-promotion budget across the planned generations, rather than repeatedly accepting nominal 5% results. Ties provide no evidence. The small default plan may reasonably retain the baseline throughout; it cannot provide fine-grained power estimates. Archive parent selection can still move on screening outcomes without labeling those parents improvements.

These controlled military fixtures measure tactics. They have limited economic development, and fortified matches can stall. They do not establish that a policy expands cities, builds siege infrastructure, or manages a generated-world campaign better. Validate promising exports with longer `sim world` runs and additional seed families before adopting them. More creative trees and better screening scores alone are not evidence of intelligence.

## Artifacts and reproducibility

Each output directory contains:

- `state.json`: optimizer RNG state, lineage, archive, current generation, completed stages and budgets; written by atomic rename.
- `engine/`: frozen production engine bundle and WASM, with hashes checked on resume.
- `candidates/`: complete parameter/feature/rule definitions with ancestry and hypotheses.
- `reports/`: raw seeded match results, resolved rules, fixture fingerprints and arithmetic faults.
- `search-summary.json` and `README.md`: selection decisions and confirmation evidence.
- `incumbent-policies.json`: a policy file usable directly with `--policy-file`; select the incumbent ID reported in the summary.

Completed stages are cached by exact configuration and artifact identity. Interrupted stages replay in fresh workers; incomplete JSON reports are rerun. Selection/checkpoints are deterministic for a fixed optimizer seed and match outcomes. On resume, accepted proposals and completed generations are reused. The harness source manifest prevents silently combining different orchestration code, and a per-output process lock prevents concurrent writers. Keep output directories trusted: they contain the JavaScript engine snapshot that resume executes.

```sh
npm run sim -- world --scenarios=default --seconds=3600 --seeds=3 \
  --policy-file=benchmarks/creative-ai-001/incumbent-policies.json \
  --policies=INCUMBENT_ID --jobs=2 --out=benchmarks/creative-ai-world.json
```
