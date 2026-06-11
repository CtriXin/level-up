# Question Schema

The interview layer is a structured decision system, not a terminal-only prompt.

It can render as:

- Codex app questions;
- Claude Code `AskUserQuestion`;
- web dashboard forms;
- terminal prompts;
- MCP tools;
- Markdown fallback.

## Question Modes

- `single`: choose one option.
- `multi`: choose multiple options.
- `text`: free-form input.
- `rank`: order priorities.
- `budget`: numeric budget or slider.

## Chat About This

`chatAboutThis` is not an answer. It is a temporary branch that lets the user and
agent discuss a decision, then return to the unresolved question.

## Skip Policy

An agent may skip a non-hard interview question only when it records:

- `question_id`;
- `skip_reason`;
- `assumption`;
- `risk_if_wrong`;
- `revisit_trigger`.

Hard questions block the run.
