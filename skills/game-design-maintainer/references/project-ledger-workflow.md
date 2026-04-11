# Project Ledger Workflow

## Canonical Files

- `docs/GAME_DESIGN_REFERENCE.md`: current and near-term game design intent. Update this when accepted scope changes the player loop, systems, UX expectations, progression, or other design-facing behavior.
- `docs/deprecations.md`: historical log of obsolete systems, workflows, render paths, or behaviors. Append new entries; do not silently remove history.
- `work_queue.md`: canonical implementation queue until the repo intentionally adopts a JSON equivalent.

## When To Update Which File

- New scope or accepted proposal:
  - Update `docs/GAME_DESIGN_REFERENCE.md` if the proposal changes intended gameplay, UX, or system direction.
  - Add a queue item if the work will be implemented later.
- Accepted plan for later implementation:
  - Add a queued task to `work_queue.md`.
  - Update the design reference when the plan changes intended behavior, not just engineering detail.
- Completed implementation:
  - Mark the matching queue item `Status: done`.
  - Update the design reference from proposed wording to current behavior where needed.
  - Add a deprecation entry if the implementation replaced or retired an older path.
- Removed or replaced behavior:
  - Add a dated entry to `docs/deprecations.md` with a short migration note.

## Queue Entry Rules

- Follow `README/work_queue_template.txt`.
- Reuse an existing task when the work is clearly the same scope; create a new task when the work is distinct.
- Use the next available `TSK-####` identifier for new standalone tasks. Use letter suffixes only for tightly related follow-on work.
- Allowed statuses:
  - `queued`
  - `in-progress`
  - `blocked`
  - `done`
- Prefer marking items `done` rather than deleting them so planning history stays queryable.

## Prioritization Rubric

1. Finish `in-progress` items first.
2. Prefer unblocked bug fixes and dependency-setting refactors before net-new features.
3. Prefer accepted queued work over inventing new work.
4. Treat polish as lower priority unless the user explicitly wants polish.
5. If several items are still close, use file order in `work_queue.md` as the tie-breaker.

## Planning Mode Acceptance Flow

When using Plan mode for deferrable work, present a choice set that includes queueing the approved plan:

- `Accept + Queue (Recommended)`: record the plan in `work_queue.md` and stop after the ledger is updated.
- `Implement Now`: approve the plan and continue into execution.
- `Revise Plan`: adjust the plan before queueing or implementing.

If the session is not in Plan mode, ask a short direct question only when the user's intent between queueing and immediate implementation is ambiguous.

## Queue Helper Commands

- Inspect current priorities:
  - `node skills/game-design-maintainer/scripts/work_queue_cli.mjs next`
- Get queue counts:
  - `node skills/game-design-maintainer/scripts/work_queue_cli.mjs summary`
- Validate queue structure after edits:
  - `node skills/game-design-maintainer/scripts/work_queue_cli.mjs validate`
- Export parsed queue data:
  - `node skills/game-design-maintainer/scripts/work_queue_cli.mjs json`

## Deprecation Entry Shape

Use a short section with:

- a specific title naming the deprecated behavior
- `Status: Deprecated as of <Month Day, Year>.`
- a few bullets explaining what replaced it, what remains supported, and how future work should behave
- migration guidance when a replacement path exists
