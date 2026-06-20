TSK-0157: Prototype bidirectional streamer road routing

Type: feature

Why: Strict point-to-point road A* could overfocus exact destination tiles, causing slow searches, brittle failures, or visually poor connectors on difficult generated terrain.

Done when:
- [x] A road-domain bidirectional streamer prototype can grow origin and destination-side fronts and join nearby validated fronts when explicitly enabled.
- [x] Production mapgen road carving does not run the streamer by default after diagnostics showed worse generation time and route quality.
- [x] Regression coverage exercises opt-in streamer route success, destination seed joining, budget abort accounting, and existing switchback/mountain-pass cases.

Touchpoints: `src/systems/roads/`, `src/mapgen/roads.ts`, `src/mapgen/stages/RoadNetworkStage.ts`, `src/ui/map-editor.ts`, `scripts/mapgen-regression.mjs`

Constraints: keep road planning simulation-first, deterministic, mapgen-authored, and independent of render behavior; do not add more production solver layers without first reducing repeated bad connector attempts.

Status: done

TSK-0156: Add map editor mapgen diagnostics

Type: feature

Why: Hydrology lake/overflow failures and road A* routing stalls were hard to diagnose from final terrain snapshots, and slow mapgen could leave the browser feeling frozen without a debug interrupt path.

Done when:
- [x] Map editor diagnostics record hydrology candidates, rejection reasons, accepted lakes, overflow routes, waterfalls, and road A* attempts/results without changing normal mapgen output.
- [x] Diagnostic preview cancellation exits through a typed mapgen cancellation path and keeps partial editor results visible.
- [x] Regression coverage verifies diagnostics do not change deterministic map output and emit hydrology/road events.

Touchpoints: `src/mapgen/`, `src/systems/terrain/sim/`, `src/mapgen/roads.ts`, `src/ui/map-editor.ts`, `scripts/mapgen-diagnostics-regression.mjs`

Constraints: keep diagnostics editor-only/off by default, preserve deterministic seeds and saved scenario compatibility, and keep terrain/road systems free of UI dependencies.

Status: done

TSK-0155: Shape archetype watershed basins for reliable lakes

Type: feature

Why: Static lake solving depends on credible preexisting terrain basins, but named island archetypes only provided broad scalar terrain bias instead of explicit watershed ridges, catchments, valley pockets, and lake-prone basins.

Done when:
- [x] Spine, Twin Bay, and Massif terrain archetypes shape deterministic watershed ridges, valley corridors, basin pockets, partial rims, spill notches, and river/lake preference fields before hydrology runs.
- [x] Static hydrology still accepts lakes through priority-flood basin geometry instead of stamped water or runtime moisture.
- [x] Fast preview hashes and mapgen hydrology smoke coverage are updated for intentional deterministic terrain drift.

Touchpoints: `src/mapgen/islandArchetypes.ts`, `src/systems/terrain/sim/noiseLandmass.ts`, `src/systems/terrain/sim/archetypeTerrainStructure.ts`, `scripts/terrain-eval.mjs`, `scripts/mapgen-regression.mjs`

Constraints: preserve deterministic seeds, existing terrain recipe/share-code compatibility, archetype visual variety, and terrain-domain ownership without adding runtime hydrology.

Status: done

TSK-0154: Route rivers from lake overflow points

Type: feature

Why: Visible rivers were still seeded by direct river-count generation before lake solving, while the intended static hydrology model has rivers continue from accepted lake overflow points and reserves future river density for rainfall/runoff-driven erosion.

Done when:
- [x] Static rivers originate from accepted lake overflow targets and no longer depend on `riverCount` or `riverBudget`.
- [x] Direct river quantity controls are removed from terrain UI surfaces while legacy values remain readable.
- [x] Regression coverage asserts ignored river-count/budget inputs, no-lake/no-river behavior, lake outlet connectivity, and existing lake/waterfall invariants.

Touchpoints: `src/mapgen/stages/RiverStage.ts`, `src/systems/terrain/sim/`, `src/ui/terrain-schema.ts`, `src/ui/mapgen-schema.ts`, `scripts/mapgen-regression.mjs`

Constraints: preserve deterministic static hydrology, saved setting compatibility, and terrain-domain ownership without adding runtime water simulation.

Status: done

TSK-0153: Add neutral terrain archetype

Type: feature

Why: The terrain generator's Archetype selector always biased generation toward a named island layout, making it hard to evaluate pure noise, coastline, relief, water, and advanced parameter behavior in isolation.

Done when:
- [x] Terrain recipes, mapgen settings, seed-code sharing, and terrain UI all accept a neutral `None` archetype.
- [x] `None` uses valid terrain defaults but does not activate Massif, Long Spine, Twin Bay, or Shelf shaping branches.
- [x] Fast-preview and evaluation scripts include the neutral archetype.

Touchpoints: `src/mapgen/islandArchetypes.ts`, `src/mapgen/terrainProfile.ts`, `src/systems/terrain/sim/noiseLandmass.ts`, `src/ui/terrain-schema.ts`, `src/ui/terrainSeedCode.ts`, `scripts/fast-terrain-preview-regression.mjs`, `scripts/terrain-eval.mjs`

Constraints: preserve existing archetype share-code indexes and default Massif behavior; keep terrain simulation logic under the existing terrain/mapgen boundaries.

Status: done

TSK-0152: Naturalize coastline envelope and mountain lake basins

Type: feature

Why: Default terrain could still read as a square-edged island or raised cut-out slab because edge falloff, sea-level bias, shoreline sculpting, and render-time coast edits could compete with the intended elevation-first island model; inland lakes were also too dependent on visible river paths instead of credible hill or mountain basins.

Done when:
- [x] Coastline shaping and sea-level edge bias use a shared organic island field instead of a uniform square inset or warped rectangle.
- [x] Default massif terrain is less central-volcano biased and supports more distributed uplands and basins without adding UI or recipe schema fields.
- [x] Static hydrology can accept strong hill/mountain basin lake candidates while preserving lake outlet, bed, ocean-separation, and water/fire invariants.
- [x] Shoreline and render passes no longer manufacture broad coast walls after flooding; final coast easing preserves low shelves and broken local cliffs.
- [x] Regression coverage tracks coastline inset uniformity, side-wall boundary traces, generated coast slope/drop, forced cliff ratio, fast-preview hashes, and default lake hit rate.

Touchpoints: `src/systems/terrain/sim/`, `src/mapgen/stages/`, `src/render/threeTestTerrain.ts`, `src/mapgen/terrainProfile.ts`, `scripts/mapgen-regression.mjs`

Constraints: preserve deterministic generation, existing terrain recipe compatibility, staged mapgen ownership, and static hydrology rather than dynamic water simulation.

Status: done

TSK-0151: Make runtime terrain height static

Type: bug

Why: Spring runtime construction could consume precomputed settlement terrain edits, mutate `state.tileElevation`, and force a full 3D terrain/water rebuild even though terrain shape and hydrology should be static during a live run.

Done when:
- [x] Runtime town construction treats legacy planned `terrainEdits` as no-op compatibility data and counts attempted use for diagnostics.
- [x] Mapgen/precomputed settlement planning can still opt into terrain elevation edits before the run starts.
- [x] Terrain geometry signatures are exposed in 3D perf diagnostics and remain stable across road-only, structure-only, and vegetation-only visual changes.
- [x] Growth regression coverage asserts runtime expansion does not mutate tile elevations.

Touchpoints: `src/systems/settlements/sim/`, `src/render/threeTestTerrain.ts`, `src/render/threeTest.ts`, `src/app/gameSessionRuntime.ts`, `scripts/growth-regression.mjs`

Constraints: keep runtime terrain/hydrology immutable, preserve old planned growth entry readability, and leave debug/mapgen elevation authoring supported.

Status: done

TSK-0150: Identify spring terrain-set bottleneck

Type: refactor

Why: Spring growth can still produce high `3D terrain set` max values even when terrain geometry is reused, because the renderer did not expose which `setTerrain()` substep was responsible and road-only or structure-only invalidations still paid base terrain color/texture costs.

Done when:
- [x] `setTerrain()` telemetry reports prepare, reuse check, surface color, tile texture, texture swap, road signature, road refresh, structure overlay, full rebuild, and water substep timings.
- [x] The perf overlay and console output show current terrain invalidation intent, update path, current hot substep, and max hot substep.
- [x] App terrain sync passes vegetation, road, structure, geometry, debug, and fire-visual invalidation intent into the 3D renderer.
- [x] Road-only and structure-only fast updates skip base terrain color/texture rebuild work while preserving road refresh and structure overlay updates.

Touchpoints: `src/render/threeTest.ts`, `src/app/gameSessionRuntime.ts`

Constraints: keep terrain sync classification in `systems/terrain/controllers/`, keep app runtime as the bridge between sync intent and renderer calls, and avoid new production modules.

Status: done

TSK-0149: Cap strategic fast time and keep 3D visual sync current

Type: bug

Why: Strategic fast-time controls exposed 40x/80x debug speeds that could let simulation advance through seasonal work faster than 3D terrain and structure visuals could stay current, making bottlenecks look like later catch-up pauses.

Done when:
- [x] Strategic preset buttons, slider sanitization, and Advance to Next Event cap at 20x.
- [x] Runtime frame budgeting preserves requested speed telemetry but clamps effective strategic simulation speed to 20x before lower simulation caps.
- [x] Fast time no longer defers terrain sync purely because speed is high, and simulation yields while 3D terrain visual sync is pending.
- [x] Regression coverage asserts the 20x cap and updates runtime perf coverage to supported high-speed values.

Touchpoints: `src/core/timeSpeed.ts`, `src/core/config.ts`, `src/app/bootLoop.ts`, `src/app/gameSessionRuntime.ts`, `src/systems/terrain/controllers/`, `scripts/time-speed-regression.mjs`, `scripts/runtime-perf-regression.mjs`

Constraints: keep incident-time pacing unchanged, preserve runtime perf telemetry, and keep terrain sync policy owned by the terrain controller boundary.

Status: done

TSK-0148: Spring growth terrain rebuild and settlement road replay fix

Type: bug

Why: High-speed winter-to-spring growth could replay town expansion work in the same frame as terrain visual refresh, causing road-only or structure-only settlement growth to force multi-second base terrain rebuilds.

Done when:
- [x] Generated settlement growth road segments record replayable paths and bridge tile indices.
- [x] Runtime planned expansion prefers recorded path replay and exposes runtime road-search fallback telemetry.
- [x] Terrain visual sync separates road-layer refreshes from base terrain geometry rebuilds, with perf telemetry for rebuild reason and road refresh timing.
- [x] Growth regression coverage asserts recorded road paths avoid runtime path search and legacy plans still fall back safely.

Touchpoints: `src/systems/settlements/`, `src/mapgen/roads.ts`, `src/sim/index.ts`, `src/render/threeTest.ts`, `src/render/threeTestTerrain.ts`, `src/systems/terrain/controllers/`, `scripts/growth-regression.mjs`

Constraints: keep road replay behind the settlement road adapter, preserve legacy synthetic/no-plan world fallback, and avoid broad terrain renderer decomposition beyond the road-layer refresh path.

Notes: Follow-up renderer decomposition remains tracked by `TSK-0134`.

Status: done

TSK-0138: Runtime spike budget and fire-season terrain sync refactor

Type: refactor

Why: High-speed strategic fire seasons could put fire catch-up, terrain visual sync, and 3D snapshot work into the same frame, producing significant lag spikes and making optimization hard to attribute.

Done when:
- [x] Fire runtime work exposes substep, deferred-day, terrain-mutation, ranged-diffusion, and ignition-candidate telemetry.
- [x] High-speed fire work is bounded per frame and carries deferred fire simulation work instead of processing every catch-up substep immediately.
- [x] Terrain visual sync policy is owned by a terrain controller and separates geometry, surface-color, vegetation, structure, and fire-visual invalidation.
- [x] Runtime perf regression coverage exists for high-speed fire scenarios.

Touchpoints: `src/app/bootLoop.ts`, `src/app/gameSessionRuntime.ts`, `src/sim/index.ts`, `src/systems/fire/`, `src/systems/terrain/controllers/`, `scripts/runtime-perf-regression.mjs`

Constraints: preserve incident readability, keep fire simulation independent from rendering/UI, and allow only small behavior shifts from bounded high-speed catch-up.

Notes: This precedes `TSK-0134`; terrain renderer decomposition should build on the new terrain visual sync boundary.

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

Related: `TSK-0138` moved terrain visual sync policy out of app runtime; continue using that boundary when splitting renderer modules.

Status: queued
TSK-0158: Separate vegetation pre-growth from settlement road planning

Type: bug

Why: The map-editor pre-growth setting was incorrectly committing 20 years of settlement expansion and excessive intratown roads into the day-one world instead of controlling vegetation maturity and spread.

Done when:
- [x] Pre-growth settings and MAP6 share-code payloads control deterministic vegetation succession only.
- [x] Starting towns use compact density-derived housing targets with bounded demand-backed road extension.
- [x] The 20-year future settlement cache remains clone-only and replays recorded roads during construction.
- [x] Every future house entry retains cumulative prerequisites from earlier successful house plans so skipped entries cannot strand later houses.
- [x] Failed future-lot trials discard all road mutations, successful road growth is limited to one bounded extension per house, and exhausted towns stop adding cached entries.
- [x] The supplied share code produces connected populated towns with materially fewer road attempts, and focused growth/mapgen regressions pass.

Touchpoints: `src/systems/terrain/sim/`, `src/systems/settlements/sim/`, `src/systems/settlements/controllers/settlementGeneration.ts`, `src/ui/terrain-schema.ts`, `scripts/mapgen-diagnostics-regression.mjs`

Constraints: preserve deterministic generation, keep future roads invisible until construction, preserve existing dirty roadbed work, and do not reintroduce runtime road searches for generated campaign maps.

Status: done
