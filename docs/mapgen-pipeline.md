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
5. `biome:fields`
6. `biome:spread`
7. `biome:classify`
8. `settlement:place`
9. `roads:connect`
10. `reconcile:postSettlement`
11. `map:finalize`

## Invariants
- `generateMap(state, rng, report?, settings?, debug?)` remains the public API.
- `MapGenContext` owns all transient mapgen fields (`elevationMap`, `riverMask`, `slopeMap`, `moistureMap`, etc).
- Stage progress is normalized through `ProgressTracker`.
- Debug snapshots are stage-labeled and emitted through `MapGenDebug`.
- `terrain:shoreline` performs an ocean-only coastal polish pass (organic shoreline smoothing + near-shore elevation sculpt).
- `settlement:place` prepares settlement-road plan data only; road carving now happens in `roads:connect`.
- `roads:connect` is non-noop and owns road/bridge network carving plus edge-mask stamping (`WorldState.tileRoadEdges`).
- Post-settlement reconcile only touches dirty regions captured from settlement deltas.
- `biome:spread` builds deterministic suitability and `forestMask` layers before `biome:classify`.

## Maintenance Notes
- Keep stage logic in `src/mapgen/stages/`.
- Keep reusable heavy logic in `src/mapgen/runtime.ts`.
- `src/mapgen/index.ts` should stay orchestration-only.

## Regression Harness
- Quick baseline/regression run: `npm run mapgen:regression`
  - Covers `medium`, `massive`, `colossal`.
- Full run (expensive): `npm run mapgen:regression:full`
  - Covers `medium`, `massive`, `colossal`, `gigantic`, `titanic`.
- Baseline snapshots are written to `docs/mapgen-regression-baseline.json`.
- Road quality gates include:
  - `ignoredDiagonalCount / roadCount <= 0.05`
  - `unmatchedPatternCount == 0`
