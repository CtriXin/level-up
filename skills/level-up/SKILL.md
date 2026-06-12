---
name: level-up
description: Composable autoresearch runtime: L3 local autopilot, worktree experiments, metric-driven keep/discard, optional interview/review/nsr-lite slots.
---

# level-up Skill

Use this skill to `level-up` a project, run `autoresearch-lite`, or let an agent experiment locally until a measurable goal improves. The default entry is natural language, not manual CLI usage.

Example trigger:

```text
用 level-up 升级 /path/to/project，目标是优化首页加载速度和事件逻辑。
```

When triggered this way, the agent owns init, scan, interview when needed, runner/worktree setup, experiments, validation, PR/MR creation, Feishu notification when configured, and the final Chinese run report.

## Contract

`level-up` is a thin core loop with optional slots. Do not turn it into a giant skill. Use runtime protocol and attach only the slots needed for the goal.

## Default Flow

1. Bind the target repository and inspect git state.
2. Build a goal contract with objective, primary metric, guardrails, non-goals, forbidden actions, stop conditions, and human gates.
3. Use the `interview` slot only for decisions that cannot be safely inferred. It replaces default `grill-me`; reserve `grill-me` for explicit deep stress-test requests.
4. Generate experiment candidates with hypothesis, expected impact, risk, validation, and rollback plan.
5. Generate a work pack with SPEC and TODO artifacts.
6. Create an isolated experiment worktree.
7. Generate a runner packet. Default runner is the current agent session; future runners may be `opencode-profile`, `mms-runner`, or `external-command`.
8. Select the next candidate with the strategy slot; prefer an untried high-priority candidate.
9. Run one experiment per round through the apply adapter when possible: command, patch, or file-write.
10. Validate through dev-loop phases, evaluate, review, then keep/discard/crash.
11. Record every result in the ledger.
12. Generate a PR/MR packet with PR body, bug-review request, and visual evidence checklist.
13. Generate `REPORT.zh.md` so the user can understand what happened without reading raw artifacts.
14. Stop before merge, deploy, or irreversible actions.

## Hard Gates

- No global config changes.
- No merge or deploy without human approval.
- No secret, billing, ads, or production data mutation.
- No silent skip of hard gates.
- No destructive cleanup in the user's current worktree.

## Slot Rule

Every slot is optional, but every skip is explicit:

```text
slot skipped: <name> reason: <why safe> assumption: <what> risk_if_wrong: <impact> revisit_trigger: <when to ask again>
```

## Agent-First Behavior

- Prefer the user's natural-language goal over asking for CLI commands.
- Ask 1-3 questions only when the answer changes objective, metric, guardrail, irreversible scope, or human gate.
- If the user says `你定`, `先做`, `defaults`, or gives a narrow target, proceed with conservative defaults.
- Create PR/MR and Feishu notification when the repo/provider is available and the run produced useful changes.
- After PR/MR merge, run merged worktree cleanup for agent-created experiment folders; remove only clean worktrees whose HEAD is already merged into the base ref, and leave dirty/current/protected worktrees alone.
- Always leave a Chinese report at `REPORT.zh.md` under the run root.
- Prefer structured apply inputs over ad hoc worktree mutation: `--apply-patch`, `--apply-write-file`, or a narrow `--apply-command`.
- After a discard, let strategy inspect evaluation before the next round; no-change should become a more concrete safe apply, validation failure should generate a validation repair candidate with its own safe apply, review-blocked should generate a blocker repair candidate with its own safe apply, and blocked apply should stop or require safer input.
- Treat repair adapters as optional capability blocks: they may summarize validation/review evidence into targeted repair proposals plus bounded repair apply plans, but they should not repeat a failed explicit apply or copy raw secrets/stdout into artifacts.
- Only use real repair commands for narrow, evidence-backed cases such as `git diff --check` whitespace cleanup; otherwise keep the repair as a bounded proposal artifact.

## Fallback CLI

The repository includes a dependency-free local runner. These commands are for debugging or manual control; the agent should usually run them itself.

```bash
npm run level-up -- init --target /path/to/repo --goal "..." --metric "..."
npm run level-up -- runner-pack --run /path/to/repo/.level-up/runs/<run-id> --runner current-session
npm run level-up -- run --run /path/to/repo/.level-up/runs/<run-id> --execute --pr-pack --report
npm run level-up -- report --run /path/to/repo/.level-up/runs/<run-id> --link <pr-or-mr-url> --notify-status "Feishu 已通知"
npm run level-up -- scan --run /path/to/repo/.level-up/runs/<run-id>
npm run level-up -- ideas --run /path/to/repo/.level-up/runs/<run-id>
npm run level-up -- work-pack --run /path/to/repo/.level-up/runs/<run-id>
npm run level-up -- dev-loop --run /path/to/repo/.level-up/runs/<run-id> --phase baseline
npm run level-up -- worktree --run /path/to/repo/.level-up/runs/<run-id>
npm run level-up -- record --run /path/to/repo/.level-up/runs/<run-id> --status keep --score 1 --description "..."
npm run level-up -- pr-pack --run /path/to/repo/.level-up/runs/<run-id> --visual
```
