# PR Workflow

Every successful `level-up` run should end in a pull request, not a silent local
branch.

The PR is the human review boundary for L3 local autopilot. The agent may create
commits and push branches, but merge and deploy remain human gates.

## Required PR Packet

`level-up pr-pack --run <run-root>` writes:

- `PR_BODY.md`: summary, goal, metrics, validation, ledger, candidates.
- `BUG_REVIEW_REQUEST.md`: bug-review prompt for a bot, reviewer, or review-hub.
- `VISUAL_EVIDENCE.md`: screenshot and annotation checklist.
- `manifest.json`: machine-readable paths and metadata.

## Bot Review

If the target platform has a review bot, the PR should request it. If no bot is
configured, the run must still produce `BUG_REVIEW_REQUEST.md` so a human or
separate AI reviewer can run the same check.

The default review stance is skeptical:

- behavioral regressions first;
- insufficient validation;
- skipped gates;
- unsafe worktree/config/secret/prod-data access;
- misleading PR claims.

## Visual Evidence

If the change affects UI, layout, design language, screenshots, copy placement,
or interaction, the PR must include visual evidence:

- before screenshot;
- after screenshot;
- annotated screenshot;
- mobile viewport;
- desktop viewport;
- short note explaining where and why the visual change happened.

The annotation is not decoration. It is the bridge between "AI changed the UI"
and "the human can see exactly what changed."

## Merge Policy

Autopilot may push branches and open PRs. It must not merge, deploy, or mutate
production without explicit approval.
