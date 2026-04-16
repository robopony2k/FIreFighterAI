TSK-0131: Extract real mapgen stags

Type: refactor

Done when:
- [x] Each pipeline stage owns its implementation outside `src/mapgen/runtime.ts`.
- [x] `generateMap()` remains the single entrypoint.
- [x] Fixed-seed mapgen output matches current behavior in regression runs.

Touchpoints: `src/mapgen/runtime.ts`, `src/mapgen/stages/`, `src/mapgen/pipeline/`, `src/mapgen/index.ts`

Constraints: preserve seed order, stage order, and debug snapshot behavior

Notes: Quick and full parity runs passed on April 11, 2026. `generateMapLegacy` remains in place for fallback/reference and can be isolated further in follow-up cleanup.

Status: done

TSK-0132: Split units subsystem by responsibility

Type: refactor

Why: `src/sim/units.ts` currently mixes roster, deployment, selection, command control, hazards, water, and suppression in one god module.

Done when:
- [ ] Roster/deployment logic is separated from runtime stepping logic.
- [ ] Selection/command logic is separated from hazards/suppression logic.
- [ ] Existing external call sites continue to use a stable public surface.

Touchpoints: `src/sim/units.ts`, new `src/sim/units/*` modules, dependent UI bindings

Constraints: preserve command semantics, selection UX, and current pathing behavior

Notes: Extract lookup helpers first to reduce repeated whole-array scans safely.

Status: queued

TSK-0135: Add experimental time-speed slider mode

Type: feature

Why: Playtesting needs a direct way to probe useful strategic and incident speeds before the final time model collapses toward skip-to-next-incident plus a smaller incident-time surface.

Done when:
- [x] A persisted runtime setting switches between preset button controls and slider controls live.
- [x] Slider mode spans 0x-80x in 0.25x steps, displays the exact speed in DOM, 3D dock, and canvas HUD surfaces, and shares one value across strategic and incident time.
- [x] 0x stops simulation without removing pause, and skip-to-next-fire temporarily forces max speed before restoring the previous slider/button value.

Touchpoints: `src/core/timeSpeed.ts`, `src/persistence/runtimeSettings.ts`, `src/sim/index.ts`, `src/ui/phase/`, `src/render/hud/hud.ts`, `src/render/threeTest.ts`

Constraints: preserve current button-mode behavior, pause flow, and skip-to-next-fire semantics

Notes: `timespeedui` is persisted, but the slider value remains session-local so playtest experiments reset cleanly on a new run.

Status: done

TSK-0133: Type and isolate the fire simulation kernel

Type: refactor

Why: The core fire step is still under `@ts-nocheck` and mixes fire math with FX, destruction, and scoring side effects.

Done when:
- [ ] `src/sim/fire.ts` no longer uses `@ts-nocheck`.
- [ ] The numeric fire update path is separated from smoke/destruction/scoring side effects.
- [ ] Fixed-seed fire regression results match current behavior.

Touchpoints: `src/sim/fire.ts`, `src/sim/fire/*`, fire regression scripts

Constraints: preserve spread behavior, block processing, and scheduled ignition semantics

Notes: Move or remove the dormant baseline branch only after typed parity is established.

Status: queued

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
