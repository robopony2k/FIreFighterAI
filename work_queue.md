TSK-0137: Add dust construction effect for house build phases

Type: polish

Why: House lifecycle stages already change geometry, but `site_prep`, `frame`, and `enclosed` builds still read as visually static during town growth. A lightweight dust effect would make active construction easier to spot and sell settlement growth better.

Done when:
- [ ] `site_prep`, `frame`, and `enclosed` house lifecycle stages can drive a lightweight construction-dust effect in the 3D runtime, while `roofed` and `charred_remains` stay unaffected.
- [ ] Dust timing/intensity is derived from lifecycle stage or visual-step progress so early construction reads differently from late construction instead of acting like constant ambient smoke.
- [ ] The house lifecycle FX Lab preview or an equivalent debugable surface can show the dust effect so it can be tuned without waiting on a live town-growth repro.

Touchpoints: `src/systems/settlements/sim/buildingLifecycle.ts`, `src/systems/settlements/rendering/`, `src/render/simView.ts`, `src/render/threeTest.ts`, `src/render/fxLab/`

Constraints: preserve current house lifecycle silhouettes and determinism, keep the effect visually distinct from fire smoke, and avoid meaningfully increasing the steady-state FX budget for towns with many simultaneous builds.

Notes: Prefer settlement-owned construction FX descriptors/data over burying lifecycle-specific rules directly inside generic fire-FX code.

Status: queued

TSK-0133: Type and isolate the fire simulation kernel

Type: refactor

Why: The core fire step is still under `@ts-nocheck` and mixes fire math with FX, destruction, and scoring side effects.

Done when:
- [x] `src/sim/fire.ts` no longer uses `@ts-nocheck`.
- [x] The numeric fire update path is separated from smoke/destruction/scoring side effects.
- [x] Fixed-seed fire regression results match current behavior.

Touchpoints: `src/sim/fire.ts`, `src/sim/fire/*`, fire regression scripts

Constraints: preserve spread behavior, block processing, and scheduled ignition semantics

Notes: Move or remove the dormant baseline branch only after typed parity is established.

Status: done

TSK-0134: Decompose terrain renderer and remove the debug cycle

Type: refactor

Why: `src/render/threeTestTerrain.ts` is a render monolith and currently participates in a cycle with terrain debug provenance code.

Done when:
- [ ] `TerrainRenderSurface` lives in a neutral terrain-render module.
- [ ] The debug provenance module no longer imports from `threeTestTerrain.ts`.
- [ ] Water, vegetation/structures, and surface-prep responsibilities are split into focused render modules.

Touchpoints: `src/render/threeTestTerrain.ts`, `src/render/terrain/debug/`, `src/render/terrain/water/`, `src/render/terrain/`

Constraints: preserve visual output and large-map performance characteristics

Notes: Keep `prepareTerrainRenderSurface` and `buildTerrainMesh` as stable facade exports during the split.

Status: queued
