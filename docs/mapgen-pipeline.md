# Map Generation Pipeline

## Overview
The map generator now runs as a staged pipeline orchestrated by `TerrainPipeline` with a shared mutable `MapGenContext`.

Entry point:
- `src/mapgen/index.ts`

Coordinator:
- `src/mapgen/pipeline/TerrainPipeline.ts`

Context:
- `src/mapgen/pipeline/MapGenContext.ts`

## Stage Order
1. `terrain:elevation`
2. `terrain:erosion`
3. `hydro:solve`
4. `terrain:shoreline`
5. `hydro:rivers`
6. `biome:fields`
7. `biome:spread`
8. `biome:classify`
9. `settlement:place`
10. `roads:connect`
11. `reconcile:postSettlement`
12. `map:finalize`

## Invariants
- `generateMap(state, rng, report?, settings?, debug?)` remains the public API.
- `MapGenContext` owns all transient mapgen fields (`elevationMap`, `riverMask`, `slopeMap`, `moistureMap`, etc).
- Stage progress is normalized through `ProgressTracker`.
- Debug snapshots are stage-labeled and emitted through `MapGenDebug`.
- Elevation still emits its historical debug subphases (`terrain:relief`, `terrain:carving`, `terrain:flooding`) before the stage-level `terrain:elevation` snapshot.
- `terrain:shoreline` performs an ocean-only coastal polish pass (organic shoreline smoothing + near-shore elevation sculpt).
- `settlement:place` prepares settlement-road plan data only; road carving now happens in `roads:connect`.
- `roads:connect` is non-noop and owns road/bridge network carving plus edge-mask stamping (`WorldState.tileRoadEdges`).
- Post-settlement reconcile only touches dirty regions captured from settlement deltas.
- `biome:spread` builds deterministic suitability and `forestMask` layers before `biome:classify`.

## Maintenance Notes
- Active pipeline stage execution lives in `src/mapgen/stages/`.
- `src/mapgen/runtime.ts` is reserved for `generateMapLegacy` and shared low-level helpers that are still consumed by both the legacy path and extracted stage modules.
- `src/mapgen/index.ts` should stay orchestration-only and depend on pipeline utilities, not stage internals.

## Regression Harness
- Quick baseline/regression run: `npm run mapgen:regression`
  - Covers `medium`, `massive` plus debug smoke checks for phase order, `stopAfterPhase`, `waitForStep`, and stage timings.
- Full run (expensive): `npm run mapgen:regression:full`
  - Covers `medium`, `massive`, `colossal`, `gigantic`, `titanic`.
- Baseline snapshots are written to `docs/mapgen-regression-baseline.json`.
- Road quality gates include:
  - `ignoredDiagonalCount / roadCount <= 0.05`
  - `unmatchedPatternCount == 0`
