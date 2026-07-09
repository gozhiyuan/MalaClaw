# Advisor / Executor Runtime Split

Use this pattern when expensive models should make decisions, but cheaper or
better-tooled runtimes should do the bulk work.

```text
workflow config
  |
  | model_tiers:
  |   advisor  -> claude-code / high-judgment Claude
  |   reviewer -> sonnet-class reviewer
  |   executor -> codex, claude-code, API, script
  v
MalaClaw flow engine
  |
  | strategy / outline / review / route
  |-------------------------------------> advisor or reviewer tier
  |
  | draft / edit / build / validate
  |-------------------------------------> executor or script tier
```

Minimal workflow shape:

```yaml
workflow:
  runtime_policy:
    primary: codex
    on_quota_exhausted: pause
    on_budget_exceeded: require_approval

  model_tiers:
    advisor:
      runtime: claude-code
      model: claude-fable-5
      max_cost_usd: 2
      requires_budget_approval: true
    reviewer:
      runtime: claude-code
      model: claude-sonnet-5
      max_cost_usd: 1
    executor:
      runtime: codex

  stages:
    - id: strategy
      owner: advisor
      model_tier: advisor
      outputs: [plans/strategy.md]

    - id: draft
      owner: writer
      model_tier: executor
      inputs: [plans/strategy.md]
      outputs: [draft.md]

    - id: review
      owner: reviewer
      model_tier: reviewer
      inputs: [draft.md]
      outputs: [reviews/review.md]
```

This is stage-level orchestration. It is different from provider-native advisor
tools, where one API model calls another model inside the same response. MalaClaw
can represent that later as a provider runtime capability, but the stage-level
pattern works across CLI harnesses, API runtimes, and deterministic scripts.
