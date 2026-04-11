---
name: game-design-maintainer
description: Maintain the repo's planning ledger and design memory by updating `docs/GAME_DESIGN_REFERENCE.md`, `docs/deprecations.md`, and `work_queue.md` whenever features are scoped, planned, implemented, replaced, or removed. Use when Codex needs to capture newly scoped gameplay or systems work, record or complete queue items, answer "what should I work on next?" from the queue, mark obsolete behavior as deprecated, or offer a planning-mode choice that can accept a plan and add it to the work queue instead of implementing it immediately.
---

# Game Design Maintainer

## Overview

- Keep the repo's living project records consistent with each other.
- Treat the design reference, deprecations log, and work queue as operational documents that should reflect current reality, not stale intent.

## Core Workflow

1. Read the relevant sections of `docs/GAME_DESIGN_REFERENCE.md`, `docs/deprecations.md`, and `work_queue.md` before updating any of them.
2. Open [references/project-ledger-workflow.md](references/project-ledger-workflow.md) when the request involves queue decisions, design-scope updates, deprecations, or planning-mode acceptance flow.
3. Use the queue helper before answering prioritization requests:
   - `node skills/game-design-maintainer/scripts/work_queue_cli.mjs next`
   - `node skills/game-design-maintainer/scripts/work_queue_cli.mjs summary`
4. Run `node skills/game-design-maintainer/scripts/work_queue_cli.mjs validate` after editing `work_queue.md`.

## Record Updates

- When scope or player-facing behavior changes, update `docs/GAME_DESIGN_REFERENCE.md` in the affected section instead of dumping notes into a new appendix.
- When an approach, system, or workflow becomes obsolete, add an entry to `docs/deprecations.md` with an absolute date and short migration guidance.
- When work is planned for later, add or update a `work_queue.md` entry instead of leaving the plan only in chat history.
- When work is completed, mark the queue item `Status: done` unless the user explicitly asks to delete completed history.

## Planning-Mode Behavior

- In Plan mode, include an explicit approval path that queues the accepted plan instead of starting implementation immediately.
- Prefer this option set when the work is being scoped for later:
  - `Accept + Queue (Recommended)`: record the approved plan in `work_queue.md`, update the design reference if needed, and stop after the ledger is updated.
  - `Implement Now`: treat the plan as approved and continue into execution.
  - `Revise Plan`: adjust the plan before either queueing or implementing.
- Outside Plan mode, ask a short direct question only when it is unclear whether the user wants immediate implementation or a queued plan.

## Prioritization Rules

- Finish `in-progress` work before pulling new `queued` work unless the user explicitly reprioritizes.
- Prefer queued tasks over inventing fresh work when the queue already contains clear, unblocked tasks.
- Prefer blocker-removal, bug-fix, and dependency-setting work before polish when several queued items are available.
- When asked what to do next, recommend one task first and optionally include up to two alternatives from the queue.

## Queue Discipline

- Use `README/work_queue_template.txt` as the format source for new entries.
- Keep acceptance criteria observable and specific.
- Keep touchpoints path-oriented so future implementation starts with the right files.
- Treat `work_queue.md` as the canonical queue until the repo adopts an explicit JSON replacement.
