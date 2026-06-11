# Spec: {{OBJECTIVE}}

## Goal

{{OBJECTIVE}}

## Target

- repo: `{{TARGET_PATH}}`
- base head: `{{BASE_HEAD}}`
- run id: `{{RUN_ID}}`

## Metric

- primary: `{{PRIMARY_METRIC}}`
- direction: `{{METRIC_DIRECTION}}`
- description: {{METRIC_DESCRIPTION}}

## Acceptance Criteria

- Primary metric moves in the intended direction.
- Guardrails remain green.
- No forbidden action is taken.
- PR packet is generated before human merge review.

## Guardrails

{{GUARDRAILS}}

## Non-goals

{{NON_GOALS}}

## Risk / Blast Radius

- scope: local experiment branch/worktree
- merge: human gate
- deploy: human gate
- production data: forbidden
