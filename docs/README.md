# Documentation

This folder is the design and maintenance memory for Firefighter AI.

- `GAME_DESIGN_REFERENCE.md` records current and near-term player-facing design intent.
- `deprecations.md` records replaced systems, obsolete workflows, and migration guidance.
- `mapgen-pipeline.md` records the current staged map generation pipeline and invariants.
- `fire-simulation-review.md` records fire-system review notes.
- `road-tiles-v2.md` records road tile reference details.
- `mapgen-regression-baseline.json` stores the checked-in mapgen regression baseline.

## Completed Queue Archive

The active queue in `../work_queue.md` only tracks pending work. Completed queue items removed from the active queue are summarized here so their implementation notes remain discoverable.

| Task | Area | Completion note |
| --- | --- | --- |
| TSK-0131 | Map generation pipeline | Extracted real mapgen stages outside `src/mapgen/runtime.ts`; `generateMap()` stayed the public entrypoint, parity runs passed on April 11, 2026, and `generateMapLegacy` remains for fallback/reference. |
| TSK-0132 | Units | Split roster, deployment, selection, command, movement, suppression, hazards, water, and recall behavior into `src/systems/units/` and `src/systems/firebreaks/`, with `src/sim/units.ts` retained as a compatibility facade. |
| TSK-0135 | Time controls | Added persisted preset-vs-slider time control mode; slider mode spans `0x` to `80x` in `0.25x` steps and preserves pause and advance-to-next-event semantics. |
| TSK-0136 | Terrain rendering | Refined 3D terrain shading to use render-only vertex colors and shared-vertex normal smoothing, while keeping legacy faceted comparison available through terrain debug controls. |
| TSK-0138 | Tactical evacuation | Added route-based town evacuation with locked road routes, representative civilian vehicles, road slot queueing, heat exposure, vehicle destruction, occupant death, and life-loss hooks. |
| TSK-0139 | Evacuation rendering | Replaced placeholder evacuation vehicle boxes with deterministic civilian car GLB rendering through the shared vehicle-instancing path. |
| TSK-0140 | Tactical evacuation | Slowed evacuation pacing, kept completed vehicles visible at destinations, and added return-home flow using the locked route in reverse. |
| TSK-0141 | Terrain editor | Added Mapgen4-inspired fast terrain previews using the shared grid landmass core for editor shape, relief, and coastline feedback. |
| TSK-0142 | Terrain editor | Streamlined early terrain editor steps to Scenario, Shape, Relief, Water, and Rivers; retired player-facing `skipCarving` authoring. |
| TSK-0143 | Terrain editor | Made Rivers a staged `hydro:rivers` preview instead of a fast landmass-water mask. |
| TSK-0144 | Terrain editor | Made Scenario, Shape, and Relief dry fast previews; Water is the first fast preview that resolves sea level and ocean rendering. |
| TSK-0145 | Terrain editor | Calibrated island shaping around `landCoverageTarget`, making Land mass the primary coastline control and sea-level bias an advanced Water override. |
| TSK-0146 | Terrain and firebase placement | Broke the center-volcano terrain read by distributing uplands, basins, ridges, shelves, and valleys, and scored firebase placement toward central lowlands. |
| TSK-0147 | Roads and settlements | Guaranteed initial firebase-to-town road connectivity through edge-connected road component verification and repair before final road grading. |
