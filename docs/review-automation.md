# PR Review Automation

`level-up` should make every successful run reviewable by default. The actual
review bot is an adapter, not part of the core runtime.

## Common GitHub Options

- GitHub notifications: when a review is requested or a PR changes, GitHub can
  notify users by email, web, or mobile depending on their notification settings.
- CODEOWNERS: GitHub can automatically request reviews from owners of affected
  files when branch protection requires it.
- GitHub Actions: a workflow can run tests, linters, custom scripts, or an AI
  review action on `pull_request`.
- GitHub Apps: services such as CodeRabbit, Qodo Merge, or custom apps can
  review PRs and comment findings.

## level-up Policy

`level-up` should always generate a PR packet:

- PR body;
- bug-review request;
- visual evidence checklist;
- machine-readable manifest.

Then a repo may attach one or more review adapters:

- `github-codeowners`: rely on CODEOWNERS and branch protection.
- `github-actions`: run deterministic CI and optional review scripts.
- `review-hub`: open a local/multi-model review slot.
- `third-party-app`: CodeRabbit/Qodo/etc. installed on the repository.

## Do Not Hardcode A Bot

Bot names and capabilities vary by repository. The runtime should accept a
configured reviewer, but it should not pretend a bot is available when GitHub
cannot resolve it.

## Visual PRs

When UI, layout, design language, screenshots, copy placement, or interaction
changes are involved, review automation must require:

- before screenshot;
- after screenshot;
- annotated screenshot;
- mobile viewport;
- desktop viewport;
- design-language notes;
- "what did not change" notes.
