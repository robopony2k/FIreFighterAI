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

TSK-0136: Refine 3D terrain surface shading

Type: polish

Why: Terrain land color was still carrying baked light/dark shading and high-frequency tile noise, while river cutout was leaving the terrain in a faceted-lighting state.

Done when:
- [x] Refined terrain uses render-only vertex colors plus shared-vertex normal smoothing so live sun/shadow drives the broad read.
- [x] Legacy faceted shading remains available through map-editor terrain debug controls for A/B comparison.
- [x] Terrain texture remains responsible for cutout/shoreline compatibility instead of owning refined land RGB.

Touchpoints: `src/render/threeTestTerrain.ts`, `src/render/threeTest.ts`, `src/render/terrain/textures/`, `src/render/terrain/water/`, `src/ui/map-editor.ts`

Constraints: preserve simulation determinism, terrain data, shoreline compatibility, and fast terrain-update reuse

Notes: `npm run check` and `npm run build` passed after the render-path changes. Visual validation is still manual in the 3D preview/runtime.

Status: done

TSK-0138: Tactical town evacuation MVP

Type: feature

Why: The old town alert/evacuation abstraction hid the tactical choice. Evacuation should be a route commitment the player reads from the map, then watches succeed or fail through civilian vehicle behavior.

Done when:
- [x] Town cards allow selecting a road-reachable evacuation destination, previewing the exact route, issuing evacuation, and cancelling a pending selection.
- [x] Ordered evacuations spawn representative civilian vehicles that follow a locked road route with tile/slot occupancy, queueing, heat exposure, vehicle destruction, occupant death, and road obstacles.
- [x] Town population/vehicle counts update, and civilian death events feed existing life-loss scoring hooks.
- [x] Route UI avoids safety scores, recommended points, best routes, ETA, survival odds, heat ratings, congestion forecasts, and advisory warnings.
- [x] Deterministic evacuation regression coverage validates route creation, invalid destination rejection, queueing, heat destruction, obstacles, loss counts, and locked routes.

Touchpoints: `src/systems/evacuation/`, `src/core/types.ts`, `src/core/state.ts`, `src/sim/index.ts`, `src/render/threeTest.ts`, `docs/GAME_DESIGN_REFERENCE.md`, `docs/deprecations.md`

Constraints: use representative vehicles, keep routes locked for MVP, use road tile/slot occupancy rather than physics traffic, reuse existing fire state and scoring hooks, and keep simulation outcomes out of rendering.

Notes: `npm run evacuation:regression` passed on May 3, 2026. The legacy alert fields remain transitional compatibility while the UI no longer exposes alert raise/lower as evacuation control.

Status: done

TSK-0139: Render evacuation vehicles with civilian car GLB

Type: polish

Why: Tactical evacuation vehicles were initially placeholder boxes. They should use the supplied civilian car asset and share the same terrain-grounded model-instancing path as firetrucks.

Done when:
- [x] Evacuation vehicles render with `assets/3d/GLTF/Vehicles/CAR_01.glb`, with fallback boxes only while the asset is unavailable.
- [x] Civilian vehicle colours are deterministic and varied, while destroyed vehicles render dark/charred.
- [x] Firetruck GLB rendering uses the shared vehicle-instancing helper without changing truck selection or movement behavior.
- [x] Evacuation vehicle visuals interpolate along locked route segments and face their current route direction.

Touchpoints: `src/render/vehicleModelLayer.ts`, `src/render/threeTestUnits.ts`, `src/render/threeTest.ts`, `src/systems/evacuation/`

Constraints: preserve tactical route UI, keep simulation outcomes out of render code, keep firetruck behavior visually stable, and do not add per-frame mesh allocation for civilian vehicles.

Notes: Added after `CAR_01.glb` was supplied as the placeholder civilian evacuation vehicle asset.

Status: done

TSK-0140: Tune evacuation pacing and return-home flow

Type: feature

Why: Evacuation cars moved too quickly, vanished as soon as they reached the destination, and gave the player no way to send evacuees back home after the immediate threat.

Done when:
- [x] Evacuation vehicle movement is slowed to a readable tactical pace.
- [x] Completed evacuation vehicles remain visible at the selected destination instead of being removed from active render data.
- [x] Town cards expose a return-home command after a completed evacuation with surviving evacuees.
- [x] Return-home uses the same locked route in reverse with existing queueing, blockage, heat exposure, destruction, and population count behavior.
- [x] Regression coverage validates arrival persistence and return-home completion.

Touchpoints: `src/systems/evacuation/`, `src/core/types.ts`, `src/ui/phase/`, `src/render/threeTest.ts`, `scripts/evacuation-regression.mjs`, `docs/GAME_DESIGN_REFERENCE.md`

Constraints: do not add route optimization, new safety advice, rerouting, ETA, or render-owned simulation outcomes.

Notes: This is a tactical evacuation follow-up to `TSK-0138` and `TSK-0139`.

Status: done
