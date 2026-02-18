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
4. `biome:fields`
5. `biome:spread`
6. `biome:classify`
7. `settlement:place`
8. `roads:connect`
9. `reconcile:postSettlement`
10. `map:finalize`

## Invariants
- `generateMap(state, rng, report?, settings?, debug?)` remains the public API.
- `MapGenContext` owns all transient mapgen fields (`elevationMap`, `riverMask`, `slopeMap`, `moistureMap`, etc).
- Stage progress is normalized through `ProgressTracker`.
- Debug snapshots are stage-labeled and emitted through `MapGenDebug`.
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
