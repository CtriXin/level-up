# Notification Adapters

`level-up` can notify humans after a PR or MR is created. Notifications are adapters, not core merge logic.

## Feishu Format

Default Feishu messages are Chinese and must include enough routing information for quick triage:

```text
【AI PR/MR】<repoName>

Model: <model> / <family>
Repo: <repoName>
Branch: <sourceBranch> -> <targetBranch>
Title: <PR/MR title + link>
状态: <validation and review status>
效果: <metric or user-visible result>
下一步: 请 review diff，确认后 merge。
```

## Secret Handling

Do not commit webhook URLs. Pass the webhook through `FEISHU_WEBHOOK_URL` or another runtime environment variable.

## Command

```bash
FEISHU_WEBHOOK_URL=... npm run level-up -- notify \
  --channel feishu \
  --repo level-up \
  --branch "codex/example -> main" \
  --title "perf: 优化首页首屏加载和事件逻辑" \
  --link "https://github.com/CtriXin/level-up/pull/5" \
  --status "check/build/self-review 通过" \
  --effect "首页主 JS gzip 下降" \
  --next-step "请 review diff，确认后 merge。"
```

Use `--dry-run` to print the payload without sending.
