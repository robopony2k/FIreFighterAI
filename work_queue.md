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
TSK-0163: Unify inland-water rendering and final waterfall classification

Type: bug

Why: River surfaces used a full-resolution contour while terrain cutouts, standing-water lakes, seam walls, and waterfall anchors used different sampled coordinate and height sources, producing visible horizontal/vertical gaps, broken lake joins, and stale waterfall placement after hydrology cleanup.

Done when:
- [x] Rivers and inland lakes share one full-resolution world-space render contract, contour, material path, and terrain cutout transform while ocean remains separate.
- [x] Terrain cutouts carry terrain-material skirts that overlap water, and the pale standalone bank-wall render path is removed.
- [x] Waterfalls are reclassified deterministically from final river/lake surfaces after lake absorption/outlet relocation, with invalid render spans omitted through diagnostics.
- [x] Accepted waterfalls use typed bank-to-bank spans, split surface seams, and explicit curtains whose endpoints match final source/target surfaces.
- [x] Terrain water, focused hydrology, FX Lab, render-performance, and runtime-performance regressions pass without changing river/lake topology or authoritative surfaces.
- [x] The initial deterministic overhead/oblique scene removed the pale skirt bands after the landward skirt-material correction.
- [x] The immutable full-resolution water contour owns XZ; terrain triangles are subtracted by the indexed water triangles, and exact terrain-edge intersections split both terrain and water without projection or snapping.
- [x] Canonical seam tops remain above authoritative water and skirt bottoms remain below it, including steep mixed-height lake edges and render strides 1-4.
- [x] Closed-bank geometric water displacement is exactly zero at the seam and reaches full strength within one water cell without disabling normal-map, foam, flow, or lake-calmness animation.
- [x] Developer ownership modes isolate terrain, skirts, inland water, and uncovered background, while hover diagnostics report original/rendered XZ, forced displacement, source contour/terrain provenance, height ordering, and pre-conformance error.
- [x] The supplied share code executes the real full-resolution production mesh path with zero moved or unmatched boundary vertices, T-junctions, unexpected open ends, shared-segment gaps, skirt-joint gaps, or water-above-seam error; calm banks no longer receive unconditional white foam.
- [x] Ownership-mode evidence identifies the remaining pale line as uncovered raster/depth space, and closed seam segments receive measured mitered submerged guard coverage in the existing terrain buffers while river-mouth openings receive none.
- [ ] The supplied deterministic scene passes renewed live overhead and oblique inspection while paused and animated without white/black cracks, skirt segment gaps, surface crossings, z-fighting, or a restored river-mouth lip.

Touchpoints: `src/systems/terrain/rendering/inlandWaterRenderSurface.ts`, `src/systems/terrain/rendering/inlandWaterMeshBuilder.ts`, `src/systems/terrain/rendering/inlandWaterTerrainCutout.ts`, `src/systems/terrain/rendering/inlandWaterTerrainSeam.ts`, `src/systems/terrain/rendering/inlandWaterSeamDebugMaterial.ts`, `src/systems/terrain/sim/finalWaterfallClassifier.ts`, `src/systems/terrain/sim/basinLakeHydrology.ts`, `src/render/threeTestTerrain.ts`, `src/render/terrain/water/`, `scripts/terrain-water-regression.mjs`, `scripts/mapgen-regression.mjs`

Constraints: preserve deterministic river/lake masks, carved elevations, beds, surfaces, share codes, and saves; keep ocean separate; rebuild static geometry only with existing terrain/hydrology invalidation; add no per-frame sampling or draw calls.

Notes: The first two geometry repairs did not solve the reported scene. Production-path evidence from share code `MAP6-115-22002R2S1W1M152B0R1G1W2R2C1X1N1J141K0Y1M1A1E181Q0K1K12161C` showed why: the projection seam moved 73 original boundary vertices more than `0.02` cells, left three unmatched, and moved one by `0.795` cells while its post-snap metric misleadingly displayed roughly zero. The failed projection approach is replaced by direct terrain subtraction against immutable indexed water triangles. The same production case at its real `1.6105` height multiplier reports zero original displacement, unmatched vertices, T-junctions, unexpected open ends, segment gaps, skirt-joint gaps, and water-above-seam error. Subsequent ownership captures showed continuous magenta skirt geometry with a pale line precisely at the cyan-water/skirt contact, proving the residual defect was uncovered raster/depth space rather than another XZ topology error. Closed banks now add a fully submerged `0.04`-cell waterward guard strip, with contour-derived interior direction and mitered joints whose minimum overlap is measured by the production regression; river-mouth openings emit neither wall nor guard. Stride 1-4 fixtures invoke the production cutout and mesh builder. F11 cycles normal, ownership, water-without-FX, skirt-only, and water-only modes. Renewed normal paused/animated overhead and oblique acceptance remains open after the guard change.

Status: in-progress
TSK-0164: Make Sea Level authoritative across shoreline and rivers

Type: bug

Why: The downstream shoreline phase recomputed sea level, changed ocean membership, and stamped a uniform coast profile after Water, so Rivers/Lakes consumed a different coastline and exposed disconnected-looking land and river mouths.

Done when:
- [x] Water's sea-level and ocean-mask arrays remain byte-identical through coast metadata and Rivers/Lakes.
- [x] The shoreline phase changes no elevations and derives only coast distance and beach/cliff/shelf classifications.
- [x] Finalization and road-lake terracing do not reshape authoritative coast or inland-water cells.
- [x] The supplied share-code regression verifies water classification, ocean-bound overflow termination, unstamped probe profiles, and non-dominant coast-stage timing.
- [x] Focused hydrology, coastline rendering, inland-water, TypeScript, and deterministic mapgen regressions pass with reviewed baselines.

Touchpoints: `src/mapgen/stages/`, `src/mapgen/runtime.ts`, `scripts/shoreline-authority-regression.mjs`, `scripts/mapgen-regression.mjs`, `docs/`

Constraints: preserve public share-code/save schemas and static runtime hydrology; allow intentional regenerated-map drift; add no renderer changes, runtime helper layers, per-frame work, or new terrain controls.

Notes: The supplied colossal map reduced `terrain:shoreline` from roughly 12.3 seconds to 20.1 milliseconds in the final focused run. Upstream beach/cliff morphology, stronger failed/short overflow routing, and expanded waterfall derivation remain separate follow-on work; do not restore downstream coast sculpting to address them.

Status: done
TSK-0165: Align beach appearance with gameplay semantics

Type: bug

Why: The terrain renderer colored authoritative ocean shelf cells with the same palette as dry playable beach, making a two-cell land beach look roughly eight cells wide and contradicting Water hover diagnostics.

Done when:
- [x] Dry beach coloring is reserved for dry land while ocean shelf cells remain authoritative Water.
- [x] Shelf seabed stays sandy but cools and darkens across the existing six-cell shoaling band, with deeper seabed continuing toward the water palette.
- [x] The ocean shader maintains a contextual `0.62`-to-`0.70` opacity-relative water floor only on the positive seaward shelf while preserving landward run-up and foam.
- [x] Coast fixtures at render strides 1-4 keep dry beach metadata on land and within three source tiles.
- [x] TypeScript, coastline, terrain-water, FX Lab, render-performance, shoreline-authority, and deterministic mapgen regressions pass without hydrology drift.
- [x] The ocean surface consumes Water's authoritative sea-level field instead of estimating a lower plane from seabed elevations.
- [ ] Clear-weather shelf water reads as light blue-green submerged shallows, with wind and active rain monotonically strengthening waves and intermittent foam while reducing clarity.
- [ ] The supplied share code passes calm and rain live overhead and oblique inspection: shelf hover reports Water, sand reads as submerged, moving breakers meet beaches, and cliffs suppress landward swash without a noticeable frame-time regression.

Touchpoints: `src/systems/terrain/rendering/coastalSeabedColor.ts`, `src/render/terrain/textures/`, `src/render/water/ocean/`, `scripts/coastline-render-regression.mjs`, `scripts/weather-visual-regression.mjs`

Constraints: do not alter sea level, ocean mask, elevations, hydrology, saves, share codes, tile types, controls, or per-frame sampling; retain the six-cell shelf for water rendering behavior.

Notes: The first live inspection found authoritative ocean cells protruding above the visible ocean. The cells were below Water's `0.508171` sea level (`167,41 = 0.484006`; `191,41 = 0.507530`), but rendering had independently estimated a `0.463015` ocean plane from seabed elevations. Rendering now consumes the supplied sea-level field. The user confirmed the contextual shelf color and water coverage look good, but the next live inspection exposed no readable breakers or swash. The shader had multiplied the already filtered landward fade by duplicate height/eligibility masks and applied shoreline advance with the wrong sign; the focused correction consumes the prepared fade once and advances toward negative landward SDF. A subsequent live check showed the now-visible breaker still read as recoloring because its fragment-stage sine clock was independent of the pulse displacing the water surface. Breaker crests, collapse trails, and swash now consume that exact vertex pulse, with crest visibility gated by displaced height and surface slope. Final live surf acceptance remains open.

Status: in-progress
TSK-0166: Blend river mouths into the ocean

Type: bug

Why: The inland-water contour stopped short of authoritative ocean cells and closed with a normal terrain skirt, leaving a land-colored lip across otherwise valid river-mouth water and a hard river/ocean motion seam.

Done when:
- [x] River contours and terrain cutouts reach the exact shared river/ocean edge without emitting a skirt or wall across the outlet.
- [x] A render-only terminal-cell overlap fades river flow, foam, color, and coverage into the existing animated ocean while side banks remain closed.
- [x] Ocean, river, sea-level, terrain, hydrology, save, and share-code data remain unchanged, with no additional draw call or per-frame topology work.
- [x] Focused water, coastline, shoreline-authority, weather, FX Lab, mapgen, and render-performance regressions pass.
- [ ] The deterministic estuary passes live overhead and oblique inspection in calm and rain without a lip, crack, void, z-fighting, or false breaker across the outlet.

Touchpoints: `src/systems/terrain/rendering/`, `src/render/terrain/water/`, `src/render/threeTestTerrain.ts`, `src/render/threeTestRiverWaterHelper.ts`, `scripts/terrain-water-regression.mjs`, `scripts/coastline-render-regression.mjs`, `docs/GAME_DESIGN_REFERENCE.md`

Constraints: preserve authoritative water classification and hydrology; keep ocean and inland water as separate existing draw calls; derive all overlap and fade fields during static terrain rendering.

Notes: Automated and synthetic geometry verification passed, including an exact shared-edge contour at render strides 1-4 and zero outlet-facing skirt edges in a full terrain cutout. Live browser inspection remains open because the in-app browser connection was unavailable in the implementation session.

Status: in-progress
TSK-0162: Add tactical watch tower placement and extended upgrades

Type: feature

Why: Automatic tower sites could overlap roads and offered no terrain or access tradeoff, while three upgrades and a broad dirt slab limited strategy and visual growth.

Done when:
- [x] Players place one tower per town on valid road-free terrain with authoritative high-ground, access-cost, and construction-time previews.
- [x] New construction and upgrades remain offline until complete, and levels extend to eight with doubling raise prices.
- [x] Tower geometry uses independently grounded concrete leg piers and visibly taller scaffold tiers without scaling the cabin indefinitely.
- [x] Placement and selected-facility states project the effective detection radius over terrain.
- [x] Existing saves normalize legacy towers as completed neutral sites and focused fire-detection/type checks pass.
- [x] Placement validates the actual leg footprint against cliffs and blocked terrain, with one grid-aligned pier system directly beneath the scaffold legs.
- [x] A cursor-following quote shows authoritative cost, access surcharge, 90-day duration, radius, elevation benefit, or rejection reason.
- [x] Initial builds remain maintenance-only, while 90-day upgrades may begin in any phase and stay offline until completion.
- [x] Tower construction advances with the always-running calendar even without fire activity, and clicking a rendered tower opens its owning Town Watch Tower interface.

Touchpoints: `src/systems/fire/`, `src/ui/runtime/town-panel/`, `src/render/threeTest.ts`, `src/core/types.ts`

Constraints: keep fire knowledge separate from authoritative fire state, preserve one tower per town, and keep gameplay calculations out of rendering.

Status: done

TSK-0159: Add town water towers V1 refill utility

Type: feature

Why: Towns need local water infrastructure so firetrucks can refuel away from the firebase using visible, settlement-owned reservoirs.

Done when:
- [x] Every generated town starts with one default water tower using deterministic placement.
- [x] Water towers are settlement-owned runtime assets with capacity, current water, service radius, and active/default state; tower structures reserve space without counting as houses or changing town house totals.
- [x] Truck refill logic uses an explicit water-source boundary that supports existing base/river/lake behavior plus tower reservoirs, with tower water decreasing when used.
- [x] Rain strongly replenishes towers and dry periods provide only a slow baseline trickle so long incidents can exhaust local reserves without leaving them permanently empty.
- [x] Runtime town context shows compact tower water status through the shared Facilities sidecar.
- [x] Regression coverage verifies V1 creation, one-per-town enforcement, deterministic placement, house-count integrity, tower refill consumption, stopped/non-spraying refill constraints, and rain/trickle recovery.

Touchpoints: `src/systems/settlements/`, `src/systems/units/`, `src/core/state.ts`, `src/render/simView.ts`, `src/render/threeTestTerrain.ts`, `src/render/threeTest.ts`, `src/ui/runtime/town-panel/`, `scripts/`

Constraints: preserve deterministic settlement placement, keep terrain and hydrology static at runtime, keep reservoir rules out of rendering, and ship V1 without upgrades, destruction, construction stages, passive suppression, progression gating, procurement, or manual tower targeting.

Notes: Implemented V1 defaults are One Per Town and Rain Plus Trickle. Passive defense, progression gating, and procurement moved to TSK-0160. No deprecation entry is needed for this net-new feature.

Status: done

TSK-0160: Add advanced water tower procurement and passive defense

Type: feature

Why: Water towers should eventually become a strategic preparedness investment and provide limited settlement protection that depends on stored water.

Done when:
- [ ] Towns can build or improve at most one local tower only after an appropriate Logistics unlock such as `municipal-water-towers`.
- [ ] Passive town defense spends tower water to reduce nearby town fire/heat risk without acting as an automated firefighter unit or awarding suppression credit.
- [ ] Maintenance/procurement UI exposes tower construction or upgrades for unlocked towns.
- [ ] Regression coverage verifies unlock gating, one-per-town enforcement through procurement, passive suppression scope, no suppression credit, and reservoir exhaustion/recovery.

Touchpoints: `src/systems/settlements/`, `src/systems/progression/`, `src/config/progression/`, `src/ui/phase/`, `src/ui/runtime/town-panel/`, `scripts/`

Constraints: keep passive protection deterministic, keep suppression credit tied to firefighter action, and keep terrain/hydrology static.

Notes: Builds on the completed V1 default water tower reservoir/refill system.

Status: queued

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
- [x] `site_prep`, `frame`, and `enclosed` house lifecycle stages can drive a lightweight construction-dust effect in the 3D runtime, while `roofed` and `charred_remains` stay unaffected.
- [x] Dust timing/intensity is derived from lifecycle stage or visual-step progress so early construction reads differently from late construction instead of acting like constant ambient smoke.
- [x] The house lifecycle FX Lab preview or an equivalent debugable surface can show the dust effect so it can be tuned without waiting on a live town-growth repro.

Touchpoints: `src/systems/settlements/sim/buildingLifecycle.ts`, `src/systems/settlements/rendering/`, `src/render/simView.ts`, `src/render/threeTest.ts`, `src/render/fxLab/`

Constraints: preserve current house lifecycle silhouettes and determinism, keep the effect visually distinct from fire smoke, and avoid meaningfully increasing the steady-state FX budget for towns with many simultaneous builds.

Notes: Prefer settlement-owned construction FX descriptors/data over burying lifecycle-specific rules directly inside generic fire-FX code.

Status: done

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
TSK-0161: Optimize steady-state 3D rendering without reducing visual quality

Type: refactor

Why: Large maps paid steady-state GPU and main-thread costs for world-sized vegetation/structure batches, a full-terrain transparent road pass, an inactive shadow-blend light, unnecessary post depth storage, and unchanged per-frame UI/scene uploads.

Done when:
- [x] Vegetation and repeated structures use bounded spatial batches with normal camera and shadow-frustum culling, and roads use sparse overlay geometry.
- [x] Steady-state shadows expose one active shadow light outside transitions, with asynchronous GPU timing and visibility counters in the existing perf diagnostics.
- [x] Accelerated seasonal lighting coalesces shadow-direction changes between blends, and renderer counters include the world instead of reporting the final fullscreen pass.
- [x] Post-processing allocates depth textures only for DOF, while unchanged dock, environment, evacuation, and vehicle work is cached or throttled.
- [x] Paused static DOM-HUD scenes can reuse the previous world frame, and focused rendering plus existing runtime/domain regressions pass.

Touchpoints: `src/core/rendering/`, `src/systems/terrain/rendering/`, `src/render/threeTest.ts`, `src/render/threeTestTerrain.ts`, `src/render/post/`, `scripts/render-performance-regression.mjs`

Constraints: preserve DPR, asset detail, effect counts, shadow resolution, water quality, simulation behavior, and player-visible output; keep fire visibility authoritative and fire FX culling independent.

Notes: A player-supplied GPU capture confirmed a roughly 30 ms world-render bottleneck, sub-millisecond post cost, near-continuous two-light transitions at 20x speed, and invalid final-pass-only draw counters. The follow-up coalesces those transitions and fixes the counters. Supported performance acceptance is 256x256; 512x512 maps are not a target and are known to crash. A fresh 256x256 capture remains required for measured before/after comparison.

Status: done
