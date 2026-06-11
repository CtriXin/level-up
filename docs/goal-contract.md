# Goal Contract

A goal contract turns human intent into an experiment boundary.

## Required Fields

- `objective`: user-facing outcome.
- `target`: local repository path.
- `mode`: autopilot level.
- `primary_metric`: the main score to improve.
- `guardrail_metrics`: checks that must not regress.
- `non_goals`: explicit things not to change.
- `forbidden_actions`: safety boundaries.
- `stop_conditions`: when the loop must stop.
- `human_gates`: actions requiring approval.

## Example

```json
{
  "objective": "Make the homepage faster without changing product behavior.",
  "mode": "l3-local-autopilot",
  "primary_metric": {
    "name": "mobile_lcp",
    "direction": "decrease"
  },
  "guardrail_metrics": [
    { "name": "build", "required": "pass" },
    { "name": "ssr_homepage_200", "required": "pass" },
    { "name": "visual_regression", "required": "no_major_regression" }
  ],
  "non_goals": [
    "Do not redesign the page.",
    "Do not remove content.",
    "Do not change ads, analytics, or production configuration."
  ],
  "human_gates": [
    "merge",
    "deploy",
    "production data mutation"
  ]
}
```
