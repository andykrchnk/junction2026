---
name: pattern-review
description: Review complete Junction implementation changes against repository patterns and scope.
---

Read the task, latest decisions, AGENTS.md and relevant entries in `.agents/patterns/CATALOG.md`. Inspect examples and callers. Establish the actual task base; review all committed changes since it, staged/unstaged changes and untracked files. Separate pre-existing work from task changes.

Check feature-slice dependency direction, request/state ownership, shared schema reuse, Effector sample wiring and read-only exports, runtime validation, authorization and session lifecycle, persistence boundaries, errors and UI states. Reject speculative abstractions and unrelated changes. Confirm links and examples resolve when instructions change.

Report actionable findings with file, impact and concrete correction. During implementation fix in-scope findings and review the entire resulting diff again. Report verification limits; call self-review self-review. Do not invent findings. This skill does not authorize commits or publication.
