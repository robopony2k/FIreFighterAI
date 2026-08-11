TSK-0192: Restore campaign-scale forest succession and canopy maturation

Type: feature

Why: Fuel-only annual growth left the forest footprint and tree structure visually static, so successful early suppression did not build the dense late-campaign canopy and catastrophic fuel exposure that the campaign is intended to create.

Done when:
- [x] One deterministic annual linear pass snapshots woody occupancy and applies ash recovery, grass/floodplain-to-shrub or direct-forest establishment, and mature-shrub-to-forest succession without within-year cascades.
- [x] Forest and shrub age, canopy, stems, and age-scaled fuel capacity mature annually on suitable unprotected land, while existing-save fuel is retained and never reduced to a lower recalculated cap.
- [x] A deterministic no-fire fixture shows visible year-8 woody expansion, at least 85% forest coverage and 80% mature forest by year 20, while periodic burns reduce final forest coverage or combustible forest fuel by at least 25%.
- [x] Forest rendering retains deterministic 20% sapling, 35% mid-sized, and 45% mature cohorts, prioritizes mature high-canopy forest under the existing 18,000-instance budget, and keeps shrub visually subordinate.
- [x] Non-fire vegetation revisions rebuild rendered tree instances so annual recruitment and canopy growth appear in the 3D world instead of being acknowledged by a no-op fast path.
- [x] Annual telemetry distinguishes aged, shrub-expanded, forest-expanded, recovered, fuel-changed, and visual-sync work; build plus focused growth, vegetation, renderer, grounding, and runtime-performance checks pass.

Touchpoints: `src/systems/terrain/sim/annualVegetationGrowth.ts`, `src/systems/terrain/sim/annualVegetationFuel.ts`, `src/systems/terrain/sim/annualVegetationSuccessionRules.ts`, `src/systems/terrain/rendering/vegetation/treePlacementPlan.ts`, `src/render/threeTestTerrain.ts`, `src/sim/index.ts`, `src/core/state.ts`, `src/app/gameSessionRuntime.ts`, `scripts/growth-regression.mjs`, `scripts/render-performance-regression.mjs`, `docs/GAME_DESIGN_REFERENCE.md`, `docs/deprecations.md`

Constraints: keep runtime growth to one O(n) annual event, preserve deterministic saves and map-generation pre-growth, add no per-tree simulation state or risk UI, and do not raise the large-map tree-instance budget.

Notes: The deterministic 31x31 no-fire fixture grows from 125 to 340 forest tiles by year 8 and reaches 718/841 viable forest tiles by year 20; 653 are mature. The paired periodic-burn fixture ends with 25.6% less combustible forest fuel. Supplied year-1/year-14 captures exposed that the vegetation-only fast path reused stale tree instances even though authoritative growth passed; non-fire vegetation sync now forces the instance rebuild while active-fire batching remains lightweight. A refreshed post-fix capture is still required for live visual acceptance.

Status: done
TSK-0191: Preserve refined terrain colour during spring vegetation refresh

Type: bug

Why: The first annual growth refresh whitened refined terrain vertex colours while partially rewriting the reused tile texture, leaving pale tile-aligned regions until a later full rebuild.

Done when:
- [x] Refined fast terrain updates recompute authoritative surface colours instead of replacing vertex colours with white.
- [x] Refined updates keep the tile texture in mask mode, including partial vegetation/type refreshes.
- [x] Renderer, growth, TypeScript, and diff checks pass against the supplied first-spring artifact.

Touchpoints: `src/render/threeTest.ts`, `scripts/render-performance-regression.mjs`

Constraints: preserve the legacy faceted colour path, partial texture reuse, seasonal shader uniforms, and terrain geometry reuse.

Notes: Fixed from the supplied static screenshot and source tracing. Live transition verification remains pending because this VS Code Codex surface cannot inspect localhost.

Status: done

TSK-0190: Replace continuous vegetation succession with annual fuel growth

Type: refactor

Why: Continuous block succession repeatedly scanned the campaign map and invalidated vegetation rendering while mature forests showed little change and their fuel quickly remained capped.

Done when:
- [x] Growth season runs one deterministic annual linear pass instead of per-tick block catch-up work.
- [x] New-campaign forests begin at 60% of moisture-adjusted carrying capacity and approach approximately 95% after 12 untreated annual events without changing mature tree visuals.
- [x] Disturbed ground recovers annually and sparse deterministic forest recruitment is suitability-gated and limited to the pre-event forest edge.
- [x] Fuel-only changes update authoritative fuel arrays without terrain or vegetation revisions; visual type changes produce one batched revision.
- [x] Runtime telemetry reports annual scan, fuel, recruitment, recovery, and visual-sync work; focused growth, vegetation, runtime-performance, and build checks pass.

Touchpoints: `src/systems/terrain/sim/`, `src/sim/index.ts`, `src/core/state.ts`, `src/app/gameSessionRuntime.ts`, `scripts/growth-regression.mjs`

Constraints: preserve deterministic seeds and existing-save fuel values, keep mapgen pre-growth separate, and do not reintroduce runtime neighborhood scans outside the annual event.

Notes: Implemented from static and automated evidence. Live visual acceptance remains pending because this VS Code Codex surface cannot inspect localhost.

Status: done

TSK-0189: Increase inland-water scale and river readability

Type: bug

Why: The routed hydrology follow-up became slow and produced fragmented aqueduct-like channels through cumulative surface stepping, lake promotion, overflow routing, and iterative cleanup.

Done when:
- [x] River generation directly thresholds erosion flow accumulation and derives shallow water surfaces from local eroded elevation without cumulative stepping, route repair, or authoritative width expansion.
- [x] Lake generation directly selects connected depression-depth cells from erosion's existing priority flood without a second solve, candidate rejection model, footprint promotion, overflow search, or iterative cleanup.
- [x] The active Rivers/Lakes stage is linear and materially faster on a 512² maximum-Hydrology fixture while retaining substantial rivers and inland lake area.
- [x] TypeScript/build and a small direct-rule smoke fixture pass without using broad topology or renderer regressions as the implementation gate.
- [ ] A refreshed Rivers/Lakes capture confirms the supplied aqueduct walls and fragmented water surfaces are gone.

Touchpoints: `src/systems/terrain/sim/drainageErosion.ts`, `src/systems/terrain/sim/depressionLakeField.ts`, `src/systems/terrain/sim/flowAccumulationRiverNetwork.ts`, `src/mapgen/pipeline/MapGenContext.ts`, `src/mapgen/stages/ErosionStage.ts`, `src/mapgen/stages/RiverStage.ts`, `scripts/terrain-hydrology-regression.mjs`, `docs/GAME_DESIGN_REFERENCE.md`, `docs/deprecations.md`

Constraints: keep hydrology static, deterministic, shallow, and particle-free; add no new editor control or MAP7 field; do not reintroduce routed overflow, validation repair, a second priority flood, or cumulative river-surface descent.

Notes: The supplied 100% Hydrology captures are valid evidence of both failures: the earlier network was visually faint, while the attempted enlargement became slow and produced deep straight-sided fragments. The final replacement reduces the 512² Rivers/Lakes stage from about 1,952 ms to 148 ms on seed 1337, with 4,105 river cells, eight depression lakes, 728 lake cells, a `0.00045` maximum river-bed depth, and no cumulative surface stepping. Live post-change appearance remains unverified in this VS Code surface.

Status: in-progress

TSK-0188: Connect drainage accumulation to viable rivers and lakes

Type: bug

Why: Erosion produced deterministic receivers and flow accumulation, but the River stage ignored them and only emitted lake-overflow channels. Post-erosion basins were rejected by obsolete area, depth, elevation, and score assumptions, leaving all current archetypes without visible rivers or lakes across common settings.

Done when:
- [x] Flow accumulation creates deterministic, ocean-bound rivers independently of lake acceptance, with Hydrology intensity and river budget changing channel extent monotonically.
- [x] Accepted lakes intercept river flow and resume it from spill outlets without overlapping river/lake ownership or breaking water surfaces.
- [x] Lake acceptance uses visible spill-contour area and normalized terrain-compatible depth/elevation thresholds, producing credible lake opportunities without accepting arbitrary single-cell puddles.
- [x] Zero hydrology intensity produces no direct accumulation rivers, while representative default/high-intensity seeds produce nonzero connected channels and bounded lake coverage.
- [x] TypeScript, focused hydrology, morphology, terrain-water, shoreline, mapgen, road, settlement, vegetation, renderer, and queue validation pass; refreshed captures remain the appearance gate.

Touchpoints: `src/systems/terrain/sim/flowAccumulationRiverNetwork.ts`, `src/systems/terrain/sim/lakeFootprintPromotion.ts`, `src/mapgen/pipeline/MapGenContext.ts`, `src/mapgen/stages/ErosionStage.ts`, `src/mapgen/stages/RiverStage.ts`, `src/mapgen/terrainProfile.ts`, `src/systems/terrain/sim/basinLakeHydrology.ts`, `src/core/config.ts`, `src/render/terrain/water/riverMeshData.ts`, `scripts/terrain-hydrology-regression.mjs`, `scripts/mapgen-regression.mjs`, `docs/GAME_DESIGN_REFERENCE.md`, `docs/deprecations.md`

Constraints: keep generation static, deterministic, bounded, and particle-free; retain current editor controls and MAP7 schema; preserve authoritative water ownership and renderer seam contracts.

Notes: Source diagnosis found erosion receivers and accumulation were diagnostic-only while the active River stage depended on accepted-lake overflow. Direct channels now threshold the shared accumulation field, carry to ocean, and convert diagonal receiver edges into deterministic orthogonal water cells. Accepted priority-flood lakes intercept those channels; credible undersized spill contours may expand only to the configured readable minimum within a bounded shore tolerance, and basin tendency lowers the viable depth floor. On the 20-seed Massif sample, default lake-bearing maps improved from 13/20 to 16/20, maximum basin tendency raised total accepted lakes from 25 to 34, and maximum river intensity no longer reduced lake-bearing seeds. The refreshed medium/massive mapgen baseline has a 100% lake hit rate, zero detached river components, orthogonal connectivity of 0.995-1.0, and connected roads/towns. TypeScript/build, focused hydrology, morphology, fast preview, randomizer, shoreline authority, coastline, grounding, terrain-water, mapgen baseline, and queue validation pass. Live localhost appearance remains unverified in this VS Code surface, so refreshed overhead and oblique captures remain the visual approval gate.

Status: done

TSK-0187: Simplify island shaping and remove conflicting terrain controls

Type: bug

Why: The late-gated square-bump blend kept most terrain on a broad plateau before dropping through sea level in a narrow coastal wall, while duplicate centre, edge, and sea-level controls obscured archetype identity and made preview and production calibration disagree.

Done when:
- [x] Surface applies a fixed 0.5 square-bump conversion to low-frequency terrain, adds fine detail afterward, and retains exact perimeter ocean without a late coastal slope spike.
- [x] Named archetypes visibly influence broad terrain and coastline plans while shared seeded noise remains the primary local surface signal and None stays neutral.
- [x] Border-water falloff, interior land floor, sea-level bias, legacy water level, skip-carving compatibility state, unused edge-water bias, and their dead coastline path are removed.
- [x] Compact MAP7 share codes contain only active fields and intentionally reject MAP6 and earlier formats; saved scenario sanitization ignores removed properties.
- [x] TypeScript, fast-preview, terrain profile/randomizer, terrain-water, morphology, hydrology, coastline, grounding, settlement, road, vegetation, renderer, performance, and supported mapgen regressions pass; post-change archetype captures remain the visual approval gate.

Touchpoints: `src/systems/terrain/sim/islandBoundaryShaping.ts`, `src/systems/terrain/sim/noiseLandmass.ts`, `src/mapgen/terrainProfile.ts`, `src/mapgen/settings.ts`, `src/ui/terrainSeedCode.ts`, `src/ui/terrain-schema.ts`, `scripts/fast-terrain-preview-regression.mjs`, `docs/GAME_DESIGN_REFERENCE.md`, `docs/deprecations.md`

Constraints: preserve deterministic generation, static erosion, active advanced archetype modifiers, saved-scenario sanitization, and Surface/Sea Level elevation identity; add no player-facing erosion control or runtime work.

Notes: Surface now converts its macro field continuously with the fixed square-bump blend, applies one bounded archetype coastline-plan offset, and adds shared seeded fine detail after conversion with only the outer-six-percent fade. Sea Level classifies the unchanged Surface exclusively from Land mass; connected-ocean expansion no longer admits above-threshold terrain. Removed recipe/settings/UI fields do not survive scenario sanitization, and `MAP7` rejects the former format. TypeScript/build, deterministic fast-preview hashes, boundary/profile fixtures, randomizer/share-code, morphology, terrain-water, hydrology, shoreline authority, coastline, grounding, settlement, road, vegetation, renderer/performance, and supported mapgen baseline generation pass. Supplied overhead and side-profile captures remain pre-change evidence; this VS Code surface cannot perform live localhost inspection, so refreshed fixed-seed archetype captures remain the visual approval gate.

Status: done

TSK-0186: Replace authored mountains with uplift-driven deterministic erosion

Type: feature

Why: Long Spine and authored crag additions directly constructed persistent final ridges that the previous `0.0014` erosion refinement could not materially reshape.

Done when:
- [x] Every named terrain archetype supplies a broad deterministic uplift field while preserving coastline envelopes, seeded controls, and large-scale identity.
- [x] Stable priority-flood drainage, unit runoff accumulation, bounded stream-power incision, routed deposition, two talus passes, and a 60-degree safety cap run once during map generation without particles.
- [x] Final morphology publishes continuous flow, wear, deposition, and rock exposure diagnostics; biome scoring and mountain material consume rock exposure without authored crag authority.
- [x] Crag uplift/footprint state, shader fields, gameplay exclusions, diagnostics, and obsolete coarse/iterative hydraulic paths are removed while public terrain recipes and share-code schemas remain unchanged.
- [x] Pure morphology fixtures, TypeScript/build, fast-preview hashes, terrain evaluation, and mapgen smoke validation pass; representative strategic and grazing-angle approval remains visual-only follow-up.

Touchpoints: `src/systems/terrain/sim/archetypeUpliftField.ts`, `src/systems/terrain/sim/drainageErosion.ts`, `src/systems/terrain/sim/terrainMorphology.ts`, `src/systems/terrain/sim/noiseLandmass.ts`, `src/mapgen/stages/`, `src/mapgen/biome/BiomeClassification.ts`, `src/render/terrain/textures/`, `src/ui/map-editor.ts`, `scripts/terrain-morphology-regression.mjs`, `docs/GAME_DESIGN_REFERENCE.md`, `docs/deprecations.md`

Constraints: preserve player-facing terrain controls and persistence schemas; keep generation deterministic and static; use no particle hydraulic erosion; retain hard classification only where gameplay topology is genuinely binary.

Notes: Automated fixtures cover replay, drainage acyclicity, accumulation, sediment accounting, depression preservation, bounded incision/deposition, footslope deposition, archetype identity, continuous morphology, and the 60-degree cap. The follow-up editor alignment renames Landform/Surface internals to Uplift/Surface, moves existing controls to their first meaningful pipeline stage, makes Rivers/Lakes observational, preserves the erosion baseline comparison and terrain-field overlays, and hides the ignored `skipCarving` control without changing its share-code slot. Supplied Uplift-step captures first showed that generic octave elevation visually obscured archetype identity, so Uplift gained an isolated field view, diverging legend, subdued coastline context, and near-overhead camera. Later Uplift/Surface captures exposed the opposite failure: excessive archetype authority and radial, then Chebyshev, edge constraints made the initial surface read as a circle or square. Surface is now noise-led, with archetype uplift retained as a bounded low-frequency bias; a noisy nonlinear square-bump constraint falls gently inland and accelerates at the exact perimeter. Surface and Sea Level share elevation, and fast-preview regression verifies deterministic hashes, noise-over-uplift interior correlation, bounded extreme Long Spine identity, nonuniform coastline contours, and sea-level-only water classification. Boundary randomization passes from 64-256 tiles; medium multi-seed, targeted massive, and multi-seed colossal validation retain coastline, lake, settlement, road, renderer, and vegetation viability. The supplied captures are valid pre-change visual evidence, but live post-change approval was not performed because this VS Code Codex surface cannot inspect localhost.

Status: done

TSK-0185: Localise crag faces and vegetated breaks

Type: polish

Why: The curved plan-view pass removed straight walls and repeated teeth, but supplied visual evidence still showed broad mesas and continuous cliff bands with similarly high faces, smooth grassy backs, and clean rock/grass boundaries.

Done when:
- [x] Long escarpment runs are replaced by one to four deterministic mass-owned face patches, each 2.5-6 tiles long, collectively covering no more than 30% of the formation and varying substantially in height and side.
- [x] Face patches occupy bounded cross-slope windows so major exposures and subordinate upper/lower ledges may terminate below the crown or above the base.
- [x] One or two compact erosion ramps interrupt local face, ledge, crown-detail, and footprint exposure while retaining the broad authoritative mountain foundation.
- [x] Crown slabs use independent crown and face presence, omit or lower roughly 36% of crown intervals, and permit no more than two consecutive strong crown slabs.
- [x] The broad cross-profile is rounded from its centre, volume-compensated without increasing maximum uplift, and rocky/blocked footprints require local geometric exposure rather than foundation uplift alone.
- [x] TypeScript/build, a 96-seed bounded face-plan sweep, a deterministic curved-ridge fixture, repeated supplied-share elevation generation, non-crag archetype gating, and final authority/exclusion smoke pass; full regression suites remain skipped as requested.
- [ ] A supplied overhead and grazing capture confirms several related outcrops, vegetated ramps, non-horizontal rock boundaries, rounded intervening crowns, and no renewed teeth, mesas, continuous bands, or isolated spikes.

Touchpoints: `src/systems/terrain/sim/cragFaceMorphology.ts`, `src/systems/terrain/sim/cragFormationMorphology.ts`, `src/systems/terrain/sim/craggyRidgeRelief.ts`, `docs/GAME_DESIGN_REFERENCE.md`, `work_queue.md`

Constraints: preserve formation selection, curved centrelines, mass positions, peak count, public state, hydrology order, downstream pathing/road/fire authority, renderer architecture, and the `0.082` hard uplift cap; add no global noise, texture, draw call, shader displacement, or fragment-depth path.

Notes: On share code `MAP6-35R80P-21002J2S161P1K1G1E0U1W2S142A1K2G1W1K0Y1M1A1E181Q0K1K12161C`, the five strong sections remain sized 143, 128, 91, 27, and 10 tiles. Integrated uplift is 9.999 versus 10.755 previously (93.0%), maximum uplift decreases from 0.06550 to 0.06540, and localised authority decreases from 45 to 16 blocked tiles and from 383 to 70 low-fuel tiles. Final generation retains zero water, road, bridge, structure, or base conflicts. Evidence is automated/static because this VS Code Codex surface cannot inspect localhost.

Status: done

TSK-0184: Erode crag plan-view morphology

Type: polish

Why: The latest overhead capture showed that expanded authoritative crags could read as long straight walls: their analytic axes were linear, width stayed nearly constant, one steep side persisted along the run, and both ends stopped abruptly.

Done when:
- [x] Each formation follows a deterministic 5-11-node centreline traced through the shared local ridge-orientation field, with bounded adjacent turns and total drift rather than a single analytic axis.
- [x] Two to four irregular outcrop masses vary width and lateral bias along the line; narrower necks, 1.5-4-tile erosion gaps, and 18-25% tapered ends break up the continuous strip.
- [x] Deterministic 2.8-6.5-tile slab intervals vary crown width, offset, height, and fracture gaps, with approximately one interval in five lowered rather than using regular sinusoidal waviness.
- [x] Optional short forks and asymmetric bulges remain subordinate, while one to three short mass-owned escarpment runs vary side and are interrupted by shoulders and eroded gaps.
- [x] A wider, lower foundation envelope preserves the existing broad hill beneath concentrated rocky masses; the existing formation selection, `0.082` total uplift cap, authority bits, archetype gates, and downstream reconciliation remain unchanged.
- [x] TypeScript/build, repeated exact-seed elevation output, a synthetic ridge morphology fixture, final supplied-share authority generation, and deterministic non-crag gating pass; full regression suites remain skipped as requested.
- [ ] A supplied overhead capture confirms that the same formations read as eroded bedrock masses rather than straight walls, embankments, regular waves, or isolated spikes.

Touchpoints: `src/systems/terrain/sim/cragFormationMorphology.ts`, `src/systems/terrain/sim/craggyRidgeRelief.ts`, `docs/GAME_DESIGN_REFERENCE.md`, `work_queue.md`

Constraints: preserve current crag frequency, authoritative elevation and footprint semantics, hydrology order, road/pathing/fire consumers, public schemas, renderer behavior, and performance class; do not add high-frequency noise or increase peak height.

Notes: On share code `MAP6-35R80P-21002J2S161P1K1G1E0U1W2S142A1K2G1W1K0Y1M1A1E181Q0K1K12161C`, five strong connected rocky sections are produced from the selected formations, sized 149, 132, 92, 28, and 10 tiles. Repeated elevation output is byte-identical. Final output contains 45 blocked and 383 low-fuel tiles, reaches 0.06550 maximum uplift, and has zero water, road, bridge, structure, or base conflicts. Evidence is automated/static because this VS Code Codex surface cannot inspect localhost.

Status: done

TSK-0183: Expand crags across prominent peaks

Type: polish

Why: The approved authoritative crag reads clearly, but conservative one-to-three formation selection can leave most of a colossal massif's highest or steepest peaks smooth and visually unrelated.

Done when:
- [x] The strongest legacy ridge candidate remains the primary formation while additional candidates are limited to local height/ridge prominence maxima or local steepness maxima with moderate ridge support.
- [x] Formation capacity scales from one on small maps to six on colossal maps; colossal Massifs request four to six formations and Long Spines request three to six, with deterministic separation between anchors.
- [x] Later-ranked formations use progressively smaller length, width, and amplitude so secondary peaks receive crag accents without every peak becoming a dominant obstacle.
- [x] The supplied colossal share code increases from one to four separated strong crag regions, preserves the approved reference formation, stays below the existing `0.082` uplift cap, and retains zero final water/infrastructure conflicts.
- [x] TypeScript/build, repeated exact-seed elevation generation, final authority smoke, and a deterministic three-formation Long Spine fixture pass; full regression suites remain skipped as requested.
- [ ] A supplied strategic capture confirms the additional peaks read as distributed crags rather than one merged rocky belt or excessive obstruction.

Touchpoints: `src/systems/terrain/sim/craggyRidgeRelief.ts`, `docs/GAME_DESIGN_REFERENCE.md`, `work_queue.md`

Constraints: preserve the original strongest crag, per-formation uplift and footprint thresholds, Massif/Long Spine archetype gate, water and infrastructure reconciliation, share/save schemas, and renderer behavior; additional density must come from peak selection and map-scaled count rather than higher individual formations.

Notes: On share code `MAP6-35R80P-21002J2S161P1K1G1E0U1W2S142A1K2G1W1K0Y1M1A1E181Q0K1K12161C`, strong connected regions increased from one to four. Final output contains 185 blocked and 762 low-fuel crag tiles, maximum uplift 0.06826, and zero water/infrastructure conflicts. Cells 106,115 and 116,118 retain their approved blocked uplift values while cell 125,114 remains unfootprinted. Evidence is automated/static because this VS Code Codex surface cannot inspect localhost.

Status: done

TSK-0182: Polish authoritative crag readability

Type: polish

Why: The authoritative fractured ridge finally reads as terrain geometry, but supplied captures show a repetitive sawtooth crown, a uniform warm stone patch, weak ledge recesses, and an abrupt material edge.

Done when:
- [x] Crown segmentation uses deterministic phase warping, varied fracture widths, correlated lateral offsets, broader crown-width variation, and approximately one lowered segment in five without raising the authority cap.
- [x] Strong steep faces receive one or two broken shoulder ribs at 25–45% of crown relief, remain low-fuel outside existing blocked-crown rules, and cannot create a continuous barrier.
- [x] Final-mode material uses authority-gated pale limestone, restrained ochre seams, bounded crown/face value separation, minimum-albedo recesses, a narrow talus apron, distance-filtered fine normals, and no parallax invocation.
- [x] TypeScript/build and exact-share-code smoke checks pass; repeated elevation-stage generation is byte-identical and final blocked/low-fuel coverage remains inside the agreed 10% increase ceiling.
- [ ] A supplied final/mask capture confirms the less repetitive crown, readable shoulder depth, integrated stone edge, and absence of black or green debug leakage.

Touchpoints: `src/systems/terrain/sim/craggyRidgeRelief.ts`, `src/systems/terrain/rendering/crags/cragRockShader.ts`, `docs/GAME_DESIGN_REFERENCE.md`, `docs/deprecations.md`, `work_queue.md`

Constraints: preserve the `0.082` total uplift cap, existing blocked-footprint threshold, deterministic generation, share/save schemas, terrain draw count, and renderer-to-simulation dependency direction; do not restore parallax as depth, independent crag geometry, fragment-depth writes, or terrain-wide shadow casting.

Notes: Implemented from supplied screenshot evidence because this VS Code Codex surface cannot inspect localhost. On share code `MAP6-35R80P-21002J2S161P1K1G1E0U1W2S142A1K2G1W1K0Y1M1A1E181Q0K1K12161C`, blocked tiles changed from 35 to 27, low-fuel tiles remained 199, maximum uplift changed from 0.06526 to 0.05771, cells 106,115 and 116,118 remain blocked, and cell 125,114 remains unfootprinted. Full regression suites were skipped at the user's request.

Status: done

TSK-0181: Escalate crags to authoritative fractured ridge formations

Type: feature

Why: Supplied `surface-v1` evidence proved that the continuous render-only mesh was active but its 0.62-unit authority-safe rise remained visually negligible at the strategic camera. Convincing crowns and scarps require elevation, movement, placement, grounding, and fuel to agree on the same larger formations.

Done when:
- [x] Massif and Long Spine crag plans add deterministic segmented crowns, transverse fracture gaps, asymmetric ledges, and 0.022–0.048 normalized local relief to the existing broad authoritative uplift before hydrology.
- [x] A deterministic two-bit `tileCragFootprint` marks blocked crown/face tiles and a wider low-fuel rocky footprint without changing share-code or save schemas.
- [x] Unit pathing, road routing/carving, settlement terrain fit, house growth, base/tower placement, and firebreak construction reject blocked footprints.
- [x] Final biome/fuel reconciliation removes water or infrastructure conflicts, forces accepted crag footprint tiles to rocky zero-fuel terrain, and clears vegetation.
- [x] The normal terrain mesh renders authoritative relief directly, preserves crag peaks from spike suppression, keeps crag triangles faceted, and retains the ridge-oriented rock field only for material/debug use.
- [x] Hover diagnostics report `pipeline=authority-v1` and distinguish blocked, low-fuel, and unfootprinted uplift.
- [ ] A supplied capture of the reported share code confirms readable fractured crowns and face depth at strategic and grazing views without water, road, town, vegetation, or grounding conflicts.

Touchpoints: `src/systems/terrain/sim/craggyRidgeRelief.ts`, `src/systems/terrain/sim/cragFootprintAuthority.ts`, `src/systems/terrain/constants/cragFootprint.ts`, `src/mapgen/`, `src/core/state.ts`, `src/sim/pathing.ts`, `src/systems/roads/`, `src/systems/settlements/`, `src/systems/fire/`, `src/render/threeTestTerrain.ts`, `src/render/threeTest.ts`, `docs/GAME_DESIGN_REFERENCE.md`

Constraints: preserve deterministic generation and existing share codes; hydrology and the main terrain mesh consume the modified elevation; rendering never creates independent collision geometry; blocked bands remain broken so they do not seal an entire massif.

Notes: Implemented from supplied screenshot evidence; this Codex surface cannot perform live browser validation. A targeted elevation-stage smoke generation of the supplied share code produced 35 blocked cells, 199 low-fuel crag cells, maximum uplift 0.0653 at 106,116, and a 0.0464 maximum cardinal elevation step (about 4.18 world units at height scale 90). Cells 106,115 and 116,118 are blocked crag footprint; non-crag cell 125,114 remains zero. TypeScript/build checks pass; regression suites remain skipped at the user's request.

Status: done

TSK-0180: [Superseded] Replace painted crags with a continuous microterrain surface

Type: feature

Why: The emitted fragment-parallax pass read as pale contour painting. Later identical captures were traced to an unbuilt `dist` tree rather than the revised renderer, so the replacement also needs an explicit version marker and a delivery check alongside enough local topology for geometric depth.

Done when:
- [x] Strong valid crag samples are segmented into deterministic connected regions and the strongest three feed one batched terrain-owned surface mesh.
- [x] Selected tiles receive adaptive local subdivision, terrain-conforming bases, deterministic ridge-oriented block planes, recessed fractures, stepped ledges, flat facet normals, restrained stone colors, shadow casting, and bounded silhouette relief.
- [x] Geometry remains within one draw call, 24,000 triangles, three subdivisions per tile, three regions, and 0.62 tile widths of rise.
- [x] Final mode no longer paints or displaces the coarse base terrain; `off` hides the surface while `mask`, `height`, and `normal` retain field diagnostics.
- [x] Water, town, road, bridge, structure, firebreak, planned-lot, and boundary validity still select the surface, and a runtime validity change conservatively hides stale geometry until rebuild.
- [ ] A supplied strategic and grazing-angle capture confirms visible geometric facets, ledges, depth, shadows, and silhouette breakup without a pale decal boundary, floating edges, infrastructure overlap, or repeated asset piles.

Touchpoints: `src/systems/terrain/rendering/crags/cragSurfaceGeometry.ts`, `src/systems/terrain/rendering/crags/cragRockField.ts`, `src/render/terrain/textures/mountainRockMaterial.ts`, `src/render/threeTestTerrain.ts`, `src/render/threeTest.ts`, `src/app/gameSessionRuntime.ts`, `scripts/craggy-ridge-regression.mjs`, `scripts/render-performance-regression.mjs`, `docs/GAME_DESIGN_REFERENCE.md`

Constraints: keep CPU elevation authoritative for water, picking, grounding, movement, fire, saves, and share codes; keep relief below the render-only gameplay-obstacle envelope; do not restore instanced rock assets, final-mode painted parallax, or coarse base-mesh displacement.

Notes: Superseded by TSK-0181 after a valid `surface-v1` capture showed 3,040 relief triangles but no strategic-camera crag form. The 0.62-unit render-only envelope was insufficient; the replacement makes the larger relief authoritative.

Status: done

TSK-0179: [Superseded] Replace instanced crags with ridge-oriented relief shading

Type: feature

Why: Captures of both low-poly geometry and the first fragment-only relief pass failed: geometry read as disconnected black protrusions, while parallax-only strata read as a flat painted patch. Strong authoritative crag ridges need continuous angular surface structure and bounded physical relief without reopening water-seam, grounding, or gameplay-authority failures.

Done when:
- [x] One deterministic terrain-sample RGBA8 field encodes normalized `tileCragUplift`, shared ridge tangent, and validity after town, road, bridge, water, structure, firebreak, planned-lot, and boundary exclusions.
- [x] The terrain mountain-rock shader renders original ridge-oriented angular blocks, stepped strata, fractured planes, crevices, restrained stone/mineral color, stronger facet normals, roughness, and bounded 12/8/6-step parallax with normal-only distance fallback.
- [x] Strong valid interior samples receive static vertex relief capped at 0.28 tile widths, while the shared validity field fades displacement to zero before water cutouts, boundaries, roads, towns, structures, firebreaks, bridges, and planned lots.
- [x] Instanced crag planning, primitive geometry, tree suppression, scene objects, LOD, shadow work, geometry telemetry, and dynamic cluster hiding are removed; crag shading adds only one texture and no terrain draw calls.
- [x] `final`, `off`, `mask`, `height`, and `normal` developer modes, cell diagnostics, field telemetry, dynamic exclusion refresh, fast-reuse compatibility, and texture disposal are wired through the existing terrain renderer controls.
- [x] Determinism, ridge encoding, stride retention, exclusion boundaries, texture refresh/disposal, shader iteration and vertex-relief limits, no fragment-depth/time input, TypeScript, and authoritative crag elevation behavior pass automated checks.
- [ ] Supplied share-code captures confirm continuous readable rock at cell 106,115, no crag treatment at cell 125,114, no black artifacts or projection swimming, and no more than 2 ms median / 3 ms p95 shader-on cost on the colossal map.

Touchpoints: `src/systems/terrain/rendering/crags/`, `src/systems/terrain/utils/ridgeOrientation.ts`, `src/render/terrain/textures/mountainRockMaterial.ts`, `src/render/threeTestTerrain.ts`, `src/render/threeTest.ts`, `src/app/gameSessionRuntime.ts`, `scripts/craggy-ridge-regression.mjs`, `docs/GAME_DESIGN_REFERENCE.md`

Constraints: keep `tileCragUplift` and CPU terrain authoritative for water, picking, grounding, movement, fire, saves, and share codes; cap render-only crag displacement below the gameplay-obstacle envelope and fade it to zero before every excluded domain. Do not copy Shadertoy source, write fragment depth, add time-dependent inputs, or add draw calls.

Notes: Superseded by TSK-0180. The Dry Rocky Gorge link was treated as visual direction only and the material code was original. The first emitted parallax pass read as a painted contour patch; the coarse-base-vertex revision was never emitted into the served `dist` tree and was therefore not visually evaluated. Final-mode presentation moved to a locally subdivided continuous microterrain surface with an explicit runtime version marker.

Status: done

TSK-0178: [Superseded] Add deterministic render geometry to strong crag regions

Type: feature

Why: Authoritative crag uplift supplied broad ridge forms, but strategic terrain still read as smooth rounded ground because fragment-stage rock detail could not create ledges, facet shadows, or broken silhouettes.

Done when:
- [x] Strong dry `tileCragUplift` regions deterministically select conservative crown, broken-ridge, shoulder, or exposed-face clusters using the same mountain-rock diagnostics and shared ridge orientation.
- [x] Reusable flat-faceted slabs, ledges, buttresses, and short shards are independently grounded, embedded, instanced in terrain chunks, shadow-capable, and bounded by fixed cluster, instance, triangle, and draw-call budgets.
- [x] Town, road, water, structure, boundary, slope, and runtime road/structure revision exclusions prevent conflicting placement without changing elevation, movement, fire, saves, or share codes.
- [x] Overlapping render trees are suppressed while authoritative vegetation and fuel remain unchanged; hover and performance diagnostics report cluster provenance, geometry, visibility, and LOD state.
- [x] Determinism, seed variation, ridge alignment, primitive complexity, exclusions, grounding depth, hard budgets, LOD hysteresis, dynamic hiding, TypeScript, and existing crag elevation behavior pass automated regression.
- [ ] Strategic-camera appearance, grazing-angle grounding, shadow readability, repetition, and camera-motion LOD are approved from a supported Browser surface or supplied captures.

Touchpoints: `src/systems/terrain/rendering/crags/`, `src/systems/terrain/utils/ridgeOrientation.ts`, `src/systems/terrain/sim/craggyRidgeRelief.ts`, `src/render/threeTestTerrain.ts`, `src/render/threeTest.ts`, `src/app/gameSessionRuntime.ts`, `scripts/craggy-ridge-regression.mjs`, `docs/GAME_DESIGN_REFERENCE.md`

Constraints: keep authoritative elevation and mountain-rock vertex displacement unchanged; preserve water/cutout topology, movement/fire authority, deterministic generation, fixed render budgets, and no per-frame placement work. Larger formations require a separately generated authoritative blocked or low-fuel footprint before their geometry may exceed the render-only envelope.

Notes: Superseded first by TSK-0179 and then TSK-0180 after supplied captures showed that compact clusters, multi-tile asset bands, and painted relief all failed visually. The historical instanced implementation remains removed; authoritative uplift now selects the continuous microterrain surface.

Status: done

TSK-0177: Add occasional authoritative craggy ridge silhouettes

Type: feature

Why: Broad rounded terrain lacked occasional broken ridge and mountain-peak silhouettes at strategic camera distance, while render-only displacement would contradict authoritative elevation and reopen terrain/water seam risks.

Done when:
- [x] Massif and Long Spine deterministically select one to three separated interior highland ridge formations with bounded uplift, broad lobes, saddles, broken segments, and asymmetric escarpment shoulders.
- [x] Crag uplift modifies authoritative elevation before Water and reinforces the existing ridge/stress field without changing public terrain settings, saves, share codes, render geometry, draw calls, or runtime work.
- [x] Focused regression coverage proves deterministic masks, different-seed variation, inactive Shelf/None output, bounded coverage/uplift/cardinal deltas, ridge alignment, and silhouette survival at render strides 1-4.
- [x] Generated crag uplift remains available as inspection-only provenance, and the Map Editor reports map-level presence, provides a normalized locator overlay, and identifies hovered crag tiles independently of biome type.
- [x] Runtime and editor tile diagnostics expose the rock-exposure, ridge, gully, and highland channels derived by the same mountain-rock mask builder used for final terrain material shading.
- [x] TypeScript, fast-preview performance, deterministic mapgen, terrain evaluation, hydrology, shoreline, inland-water, grounding, vegetation, units, and renderer regressions pass.
- [ ] Strategic-camera appearance is approved from a supported Browser surface or supplied captures across representative seeds and map sizes before enabling a weaker Twin Bay profile.

Touchpoints: `src/systems/terrain/sim/craggyRidgeRelief.ts`, `src/systems/terrain/sim/noiseLandmass.ts`, `src/mapgen/`, `src/core/state.ts`, `src/render/terrain/textures/mountainTerrainVisuals.ts`, `src/render/threeTestTerrain.ts`, `src/render/terrainPreview.ts`, `src/render/threeTest.ts`, `src/ui/map-editor.ts`, `scripts/craggy-ridge-regression.mjs`, `scripts/fast-terrain-preview-regression.mjs`, `docs/GAME_DESIGN_REFERENCE.md`

Constraints: preserve deterministic seeded generation, authoritative terrain ownership, existing terrain/water topology, public setting and persistence schemas, terrain render vertex/draw budgets, and no per-frame terrain work; keep geometric mountain-rock displacement disabled.

Notes: Source implementation and automated acceptance are complete. Massif/Long Spine relief and water preview hashes intentionally changed while height, Twin Bay, Shelf, and None hashes remained stable. The generated uplift map is retained as immutable diagnostic provenance rather than being inferred from the broader `rocky` biome. The existing fragment-stage mountain-rock material supplies surface detail without vertex displacement, and its CPU-built mask channels now remain inspectable without adding a draw call or per-frame sampler. Live silhouette and rocky-material approval remain external to this VS Code session. The unrelated fire regression still reports its existing high-speed event-cap/advance-event failures; terrain elevation and terrain-wind assertions within that suite pass.

Status: done

TSK-0174: Align ocean and cloud motion with gameplay wind

Type: bug

Why: Ocean phases and wind-driven normal sampling moved visible detail against the supplied wind, while cloud offsets advanced only on the fixed 0.25-second simulation tick and appeared to stair-step beside frame-smooth water.

Done when:
- [x] Coastal geometry, sampled surface detail, and production raymarched ocean hits and normals use one downwind phase convention without changing shoreline-normal breakers or tides.
- [x] The direct MdXyzX reference keeps its original unbiased phase while the production adapter applies the existing energy-dependent gameplay-wind bias.
- [x] Cloud offsets and morph time interpolate authoritative career time between simulation samples without wall-clock integration, backward alpha jumps, pause drift, or per-frame allocation.
- [x] TypeScript, weather, renderer, FX Lab, and queue regressions pass.

Touchpoints: `src/render/water/ocean/`, `src/systems/climate/controllers/`, `src/systems/climate/rendering/`, `src/render/threeTest.ts`, `scripts/weather-visual-regression.mjs`, `scripts/render-performance-regression.mjs`, `scripts/fx-lab-showcase-regression.mjs`, `docs/`

Constraints: preserve authoritative wind and career time, pause behavior, deterministic cloud travel, the direct MdXyzX reference, ocean carrier geometry, texture/draw budgets, saves, share codes, and simulation state; live motion acceptance still requires a supported Browser session or attached recording.

Notes: Source analysis showed the ocean used positive time in wind-biased wave phases and positive wind UV offsets, which makes sampled features travel against their direction. Cloud direction was already correct, but its uniforms inherited the campaign's four-Hz fixed simulation cadence. Production now uses driven MdXyzX overloads and the sky dome receives allocation-free interpolated motion uniforms each render frame. Automated evidence passes; live visual acceptance remains external to this VS Code session.

Status: done

TSK-0176: Redistribute vegetation into terrain-responsive woodland clusters

Type: feature

Why: Broadly uniform tree placement obscured terrain and climate character, produced planted-looking edges, and did not keep campaign succession aligned with sheltered or exposed terrain.

Done when:
- [x] Mapgen derives deterministic moisture, wind exposure, lee shelter, curvature, drainage, coast exposure, cluster, and site-quality fields in bounded linear passes.
- [x] Forest spread produces coherent stands, retained clearings, pruned speckles, and terrain-responsive canopy/stem structure without adding hidden fire modifiers.
- [x] Campaign succession reuses cached terrain site quality and render-only tree candidates use deterministic blue-noise placement with fair global budget thinning.
- [x] Focused vegetation plus climate, growth, grounding, renderer, runtime, and mapgen regressions pass.
- [ ] Normal strategic-camera appearance is approved from a supported Browser surface or supplied captures across representative seeds and terrain archetypes.

Touchpoints: `src/systems/terrain/sim/`, `src/mapgen/biome/`, `src/systems/terrain/rendering/vegetation/`, `scripts/vegetation-distribution-regression.mjs`

Constraints: preserve seed determinism, saved-setting/share-code compatibility, explicit fuel authority, and O(n) generation/rebuild work without runtime spatial queries.

Notes: Source implementation and automated acceptance are complete. Live visual approval remains open because the current VS Code Codex surface cannot inspect the running WebGL view.

Status: done

TSK-0176A: Tune terrain-responsive vegetation for strategic-camera readability

Type: polish

Why: The first strategic-camera capture shows a dense coastal vegetation ring, sparse sheltered inland terrain, weak broad windward/leeward contrast, residual isolated trees, and insufficient visual separation between coastal scrub and inland woodland.

Done when:
- [x] Tall-tree density no longer forms a continuous coastal perimeter; exposed coast reads primarily as scrub or low vegetation, with trees limited to coherent sheltered pockets.
- [x] Sheltered inland valleys, leeward slope faces, gullies, and drainage corridors form readable woodland regions while ridges, rock, infrastructure, and town sightlines remain open.
- [x] Forest masks and render placement have softer coherent edges and materially fewer isolated outlier trees without removing intentional clearings.
- [x] Deterministic field and placement hashes, O(n) generation/rebuild behavior, instance budgets, and authoritative fuel/biome separation remain intact.
- [ ] Fixed-state strategic-camera captures pass across at least three seeds and the Massif, Long Spine, and Shelf terrain archetypes.

Touchpoints: `src/systems/terrain/constants/vegetationDistributionTuning.ts`, `src/systems/terrain/sim/vegetationTerrainFields.ts`, `src/systems/terrain/sim/treeSuitability.ts`, `src/mapgen/biome/BiomeSuitability.ts`, `src/mapgen/biome/ForestSpread.ts`, `src/systems/terrain/rendering/vegetation/treePlacementPlan.ts`, `src/render/threeTestTerrain.ts`, `scripts/vegetation-distribution-regression.mjs`

Constraints: correct the measured grass/scrub tall-tree leakage and recalibrate the existing moisture/exposure fields before considering any larger architecture change. Add only a bounded broad-scale wind aggregation if normalized field tuning cannot make slope-face response coherent. Preserve saves, share codes, simulation authority, deterministic seeds, instance budgets, and no runtime spatial queries.

Notes: Planned from user-supplied August 5, 2026 strategic-camera captures. Reproduction share code `MAP6-I2W7TL-21002P23131P261G0L1K1W281N02002M191K0Y1M1A1E181Q0K1K12161C` decodes to colossal Long Spine seed `1093253529`, vegetation density `0.52`, patchiness `0.42`, and 20 years of pre-growth. Before tuning, only `2.46%` of land was forest; the first eight coastal tiles were `11.09%` forest versus `1.11%` inland, grass supplied roughly `5,324` tall-tree candidates, and the exposure/shelter fields were too weak to affect broad faces. The final production pipeline now has `0%` forest in the first eight coastal tiles, `3.08%` deep-inland forest, `27.05%` lower-leeward coverage, `34.56%` inland sheltered-drainage coverage, zero grass tall-tree candidates, and approximately `97%` of tall-tree candidate weight from actual forest. TypeScript, focused vegetation, mapgen, climate, growth, grounding, renderer, and runtime-performance regressions pass. The supplied still is sufficient to identify the original static distribution problems, but final multi-seed appearance, LOD stability, and camera-motion approval remain open.

Status: in-progress

TSK-0175: Prototype volumetric grass fidelity in FX Lab

Type: feature

Why: Flat grass tiles lacked close-range structure, wind response, and a readable green-to-cured transition, while the supplied ShaderToy prototype had not yet been exercised against the game's terrain, camera, depth, and lighting.

Done when:
- [x] FX Lab exposes a grass-fidelity scenario using the real showcase terrain, orbit camera, grass mask, scene depth, wind, and key light without enabling the effect in campaign rendering.
- [x] The adapted shader retains deterministic wind, blade, density, curing-colour, canopy, and fixed 144-step raymarch behavior with repeatable grass controls and diagnostic views.
- [x] Terrain field uploads occur only on terrain rebuild, resource failure falls back to the normal scene, and the obsolete disabled ground-colour grass patch is removed.
- [x] Mixed maps use a conservative grass-distance field, projected-size rejection, and cached 128-256px wind/property fields to avoid full raymarch work over non-grass and sub-pixel regions without lowering output resolution or the 144-step ceiling.
- [x] The aggressively optimized grass layer raymarches at 60% linear resolution, reconstructs with stable hardware bilinear filtering, and uses projected 96/64/40 sampling tiers while the final scene composite remains full resolution.
- [x] Volume Clumps samples continuously interpolated packed height at each occupied step, selectively raises work on steep slopes, rejects samples outside the canopy before detail work, and caches wind, properties, and lighting once per ray.
- [x] Grass length is capped at 0.25 after deterministic spatial variation, while independent wind-response and wind-speed controls can isolate bending from animation shimmer.
- [x] Grass/non-grass junctions preserve strict zero ownership outside grass while canopy height and density feather inward, avoiding a vertical volume face at square tile boundaries.
- [x] Wind motion remains frame-smooth but uses slower intermittent gusts, reduced bending and canopy pulsing, while projected-size filtering removes fine hashes and hard blade occupancy before they form distant moire or close vertical columns.
- [x] FX Lab offers the original tuned Volume Clumps and an alternate WebGL2 PCG SDF Blades renderer adapted from the supplied implicit-map study, bounded to 64 steps, real terrain/masks/depth, shared curing controls and wind, with an explicit fallback on unsupported contexts.
- [x] TypeScript, FX Lab, renderer, and queue regressions pass.
- [ ] User-supplied fixed-state captures and an accelerated ageing recording pass live visual acceptance without mask leakage, floating roots, depth errors, moire, or hard volume boundaries.

Touchpoints: `src/systems/terrain/rendering/vegetation/`, `src/render/fxLab/`, `src/render/threeTestTerrain.ts`, `scripts/fx-lab-showcase-regression.mjs`, `docs/`

Constraints: keep the prototype FX-Lab-only; preserve simulation, fuel profiles, saves, share codes, map generation, and campaign rendering; retain full-resolution scene output, stop the reduced grass march at authoritative scene depth, keep distance skipping conservative at grass boundaries, and rebuild static property fields only when terrain dimensions change.

Notes: The ShaderToy source was supplied by the user from `https://www.shadertoy.com/view/7cyGzd`. The first live look was visually approved but slow, so procedural FBM moved from every occupied march sample into one animated and one static bounded texture prepass; the packed terrain alpha channel now provides conservative empty-space skipping for mixed 256x256 maps. An intermediate 75%-resolution 144/96/64 profile measured roughly 5-10 ms and approved dryness, length, and medium-distance readability, but identified excessive motion, close streaking, and distant moire; the stability pass slowed phase continuously and filtered projected frequencies. The explicitly requested aggressive Volume Clumps profile measured roughly 6 ms at 60% resolution with 96/64/40 tiers and per-ray cached fields. A stabilization attempt cached a local terrain plane per ray, but later live captures showed that extrapolating it across multiple terrain cells created large translucent walls at oblique angles. Volume Clumps now returns to one continuously filtered packed-height sample per occupied step and retains cheap per-ray slope work selection. Follow-up captures isolated a smaller remaining wall at square grass/non-grass junctions: authoritative ownership remains binary, while filtered coverage now collapses canopy height and density inward on the grass side so the volume has no hard vertical face; March Work uses the same weighted coverage. The profile also uses stable bilinear layer reconstruction, caps final local length at 0.25, and exposes wind-response/speed controls. An upward-looking capture separately exposed false grass slabs in no-depth sky pixels; both variants reject those rays before terrain evaluation or marching. A user-supplied PCG implicit-map study remains a separate comparison rather than replacing Volume Clumps. Its first live capture measured about 11 ms and exposed tile-scale columns, canopy-entry sheets, and a persistent ANGLE warning; the follow-up uses actual blade-scale dimensions, a shallow 64-step volume, per-ray cached properties, and a single initialized map return without vec4 outputs. Automated evidence can be completed in VS Code; final appearance, motion, compiler-log, and comparative GPU-time acceptance require the requested user captures.

Status: in-progress

TSK-0173: Rebase distant ocean rendering on MdXyzX raymarched hits

Type: bug

Why: The temporary flat-carrier normal spectrum produced long grooves, rectangular highlights, and overview lattice patterns because it never reconstructed the displaced per-pixel water surface shown by the intended MdXyzX reference.

Done when:
- [x] FX Lab provides isolated current/reference/split views plus height, hit-distance, raymarch-work, normal, and Fresnel diagnostics using the gameplay camera.
- [x] The shared MdXyzX core retains radial phase, derivative-driven position drag, sin/cos directions, declining weights, and 1.18/1.07 frequency/time progression.
- [x] Open and distant ocean fragments reconstruct a bounded height-field hit and normal while the distant carrier remains exactly 1,456 triangles.
- [x] Existing shoreline displacement, breakers, foam, masks, shallow-water colour, and terrain interaction remain authoritative through a shoreline-derived transition.
- [x] Existing water quality and pixel footprint bound raymarch/normal iterations and calm distant normals; FX Lab exposes production hit, work, normal, and coastal-blend views.
- [x] Strategic LOD filters sub-pixel frequencies separately from bounded normal calming and blends to a lower-iteration broad-scale slope evaluation from the same MdXyzX function.
- [x] TypeScript, renderer, FX Lab, coastline, shoreline-authority, and terrain-water regressions pass.
- [ ] The production overview has no stable diamond, crossed-band, radial, moiré, or long-groove pattern during slow camera movement.
- [ ] The production shoreline has no rectangular seam or broken hand-off, and the same-camera GPU-world median is recorded after 120 warm-up frames.

Touchpoints: `src/render/water/ocean/`, `src/render/threeTestOceanWaterHelper.ts`, `src/render/oceanWaterDebug.ts`, `src/render/fxLab/`, `scripts/render-performance-regression.mjs`, `scripts/fx-lab-showcase-regression.mjs`, `docs/`

Constraints: keep the carrier at 1,456 triangles; preserve coastal rendering and authoritative terrain/hydrology; add no simulation, save, share-code, texture-sampler, or dense-geometry changes; live motion and measured GPU acceptance require a supported Browser session or attached evidence.

Notes: The August 3 FX Lab split capture approved reference mode 2: its short irregular crests and broken highlights were materially closer to the intended ocean, while modes 5 and 6 confirmed bounded raymarch concentration and local normals. Production integration now shares that core instead of the rejected 12-band approximation. A subsequent campaign capture showed the initial distance normal fade reached full vertical at roughly 82.6 world units and erased the valid low-frequency field at strategic zoom; filtering is now separated from bounded flattening, with a 0.22-domain macro slope tier taking over as footprints grow. Final campaign motion, shoreline, and GPU evidence remain open.

Status: in-progress

TSK-0172: Add a far-tree impostor rendering tier

Type: refactor

Why: The supported 256x256 campaign view submitted every distant GLB tree mesh and shadow caster, making world rendering and shadow refreshes the dominant GPU cost at overview distance.

Done when:
- [x] A deterministic 1024x1024 runtime color and role-mask atlas captures every loaded tree variant from four fixed azimuths and falls back to full models if capture fails.
- [x] Occupied 64-tile vegetation chunks switch exclusively between existing GLB batches and one merged camera-facing impostor draw using 18/24 CSS-pixel hysteresis.
- [x] Impostors preserve seasonal and burn state, use fog/depth/tone mapping/alpha coverage, cast no shadows, and retain existing fire anchors and near/middle tree behavior.
- [x] Campaign and FX Lab share the path; FX Lab exposes Auto, Force Models, and Force Impostors, while persisted `treeimpostors` enables A/B fallback.
- [x] Diagnostics and focused regressions cover atlas layout, LOD transitions, visibility ownership, seasonal/burn synchronization, fallback, and resource lifetime.
- [ ] The same-camera 256x256 capture reaches the triangle, draw-call, and GPU-world acceptance targets after warmup.
- [ ] Forced-model and automatic comparisons retain acceptable silhouettes, grounding, season, and burn appearance.

Touchpoints: `src/systems/terrain/rendering/vegetation/`, `src/render/threeTestTerrain.ts`, `src/render/threeTest.ts`, `src/render/fxLab/`, `src/persistence/runtimeSettings.ts`, `scripts/render-performance-regression.mjs`, `docs/`

Constraints: preserve authoritative simulation vegetation, near/middle GLB geometry and shadows, current fire-FX anchors, save-world/share-code formats, and UI/controller-to-terrain dependency direction; live visual and measured GPU acceptance requires a supported Browser session or attached captures.

Notes: This first tier deliberately excludes cross-fading, multiple elevation bands, normal/depth impostor maps, and middle-distance mesh LOD. The August 3 live capture rejected the first result: triangles fell only about 8%, GPU-world time about 7%, and the impostors looked worse. It also exposed behind-camera chunks incorrectly returning to full shadow-casting models; the controller now keeps off-screen chunks on the shadowless representation, pending a fresh capture and visual review.

Status: in-progress

TSK-0171: Replace seasonal cloud bands with morphology-driven volumes

Type: polish

Why: The first packed-volume cloud field still gave every season one shallow symmetric envelope, so fair clouds formed horizontal ripples, winter lacked ominous depth, and autumn could read as heavier than winter.

Done when:
- [x] Smooth seasonal profiles produce sparse tall spring/summer cumulus, intermediate broken autumn stratocumulus, a lower deeper winter deck, and a nearly connected active storm front.
- [x] The generated weather texture packs cellular placement and growth data, while the padded 32³ atlas packs Perlin-Worley bodies, rounded billows, and two erosion scales without native 3D textures or external assets.
- [x] CPU and GPU density reject empty weather before atlas sampling and use balanced warped volume coordinates, asymmetric height gradients, and slow internal-only morphing.
- [x] Occupied slices use one bounded lighting probe while the renderer retains two textures, one sky draw, a fixed 20-slice ceiling, early transmittance exit, and allocation-free state updates.
- [x] Determinism, seasonal morphology, wind/time behavior, texture/resource limits, TypeScript, weather, render, and FX Lab regressions pass.

Touchpoints: `src/systems/climate/rendering/seasonalCloud*.ts`, `src/systems/climate/rendering/seasonalSky*.ts`, `scripts/weather-visual-regression.mjs`, `scripts/render-performance-regression.mjs`, `docs/`

Constraints: preserve existing sky entrypoints, climate-owned deterministic motion, pause behavior, WebGL-compatible 2D texture uploads, one sky draw, and unrelated dirty terrain ledger changes; add no saves, assets, player settings, or wall-clock animation.

Status: done

TSK-0170: Enforce safe terrain generation envelopes

Type: bug

Why: Production terrain controls and randomization could combine extremely low land coverage and height settings into flat shelf maps, while high coverage, raw sea-level offsets, and weak border falloff could crowd land against the world boundary.

Done when:
- [x] Player/editor sliders and slider randomization lock Relief and Ruggedness to 75-100% and Max height to 50-100%, while terrain-owned production limits normalize Land mass to 50-70%, Max height to 40-100%, and border-water falloff to 40-100%.
- [x] Sea-level bias deterministically adjusts effective land coverage by at most two percentage points before calibration instead of applying a nonlinear post-calibration height offset.
- [x] Legacy share codes remain readable but normalize unsafe terrain values without changing the wire format.
- [x] Boundary regressions cover every archetype at 64, 128, and 256 tiles for land coverage, perimeter ocean, coastline inset, visible relief, and deterministic replay.
- [x] TypeScript, terrain randomizer, fast-preview, terrain evaluation, and deterministic mapgen regressions pass.

Touchpoints: `src/systems/terrain/constants/terrainGenerationLimits.ts`, `src/systems/terrain/sim/`, `src/mapgen/terrainProfile.ts`, `src/ui/terrain-schema.ts`, `scripts/terrain-randomizer-regression.mjs`, `scripts/fast-terrain-preview-regression.mjs`, `docs/GAME_DESIGN_REFERENCE.md`

Constraints: preserve deterministic seeds, the existing terrain recipe and share-code schemas, Water's sole ownership of sea level and connected ocean membership, and terrain-to-UI dependency direction.

Status: done

TSK-0169: Upgrade seasonal clouds with balanced volumetric depth

Type: polish

Why: The seasonal sky used layered planar cloud shapes with limited depth and lighting, so fair-weather cumulus and storm fronts did not reach the intended ShaderToy-inspired atmosphere.

Done when:
- [x] A deterministic 2D weather texture and padded 32³ packed volume atlas drive matching CPU sun occlusion and GPU cloud density.
- [x] The single sky draw intersects a bounded cloud slab and uses a capped 20-slice front-to-back march with path-length extinction, detail erosion, early exit, and two bounded sunward lighting probes.
- [x] A rotated low-frequency weather map gates coherent large footprints while trilinearly interpolated true 3D density shapes rounded bodies without a heightfield-derived top.
- [x] Spring and summer leave substantial clear gaps between fewer, larger cumulus bodies with tall locally opaque crowns; winter and active rain produce progressively broader, darker formations.
- [x] Stable world-seeded weather time evolves the third noise axis slowly while the prevailing and seasonal gameplay-wind direction carries formations visibly across the sky at normal speed.
- [x] Instantaneous wind and rain-event seed changes cannot reproject or teleport accumulated cloud travel; simulation career time and pause behavior remain authoritative without new saves, assets, controls, or wall-clock animation.
- [x] Reused WebGL contexts clear incompatible 2D upload flags before Three.js creates its internal 3D/array fallback textures.
- [x] The seasonal sky implementation is split into focused climate-rendering modules and all consumers use that boundary.
- [x] TypeScript, weather visual, render-performance, and queue regressions pass.

Touchpoints: `src/systems/climate/rendering/seasonalCloud*.ts`, `src/systems/climate/rendering/seasonalSky*.ts`, `src/render/`, `scripts/weather-visual-regression.mjs`, `scripts/render-performance-regression.mjs`, `docs/`

Constraints: retain two generated packed cloud textures and one sky draw; cap the march at 20 slices with early exit; preserve deterministic climate-driven motion and existing public sky state behavior; do not port external shader source.

Notes: The initial 12-slice implementation was rejected after live comparison because it extruded a 2D field by height, translated without shape evolution, and made fair-weather clouds translucent. A follow-up stacked-slice pseudo-3D sampler was also rejected because shallow rays exposed repeated streaks and turned sparse summer coverage into a textured ceiling. A broad-footprint correction still read as horizontal shelves because each occupied column shared one slab top, and multiplying current wind by total elapsed time made direction changes reproject the whole cloud field. The accepted correction slows internal evolution, enlarges the broad footprint scale while nonlinearly reducing fair-season occupancy, analytically integrates the prevailing and seasonal gameplay-wind track, and replaces tri-planar height shaping with a padded 32³ RGBA volume atlas. Texture-offset sign is inverted so visible formations travel with the wind rather than against it. Both cloud inputs remain WebGL-compatible 2D textures: the second is an atlas whose padded slices are interpolated through Z as a continuous volume. Reported `texImage3D` errors came from Three.js initializing unrelated internal fallback textures on a reused context with stale flip-Y/premultiplied-alpha state, now reset by the shared context boundary.

Status: done

TSK-0167: Randomize new-campaign terrain setup

Type: feature

Why: Creating a fresh terrain recipe required changing the seed and every terrain control manually, while developer-oriented fuel-profile fields occupied a large campaign setup surface.

Done when:
- [x] Separate Randomise Seed and Randomise Sliders buttons change only their respective source of terrain variation.
- [x] The numeric seed is displayed and editable separately from the share code.
- [x] The share code continuously encodes the current seed, map size, and terrain variables, and valid imported codes update both fields and controls.
- [x] The selected map size and configured fuel-profile overrides remain unchanged.
- [x] Fuel-profile controls are removed from the new-campaign Terrain interface while SIM Lab tuning remains available.
- [x] TypeScript and focused randomizer regression coverage pass.

Touchpoints: `index.html`, `styles.css`, `src/ui/character-select.ts`, `src/ui/terrainRandomizer.ts`, `src/ui/phase/bindings/phaseBindingsRuntime.ts`, `scripts/terrain-randomizer-regression.mjs`, `docs/`

Constraints: preserve share-code compatibility, saved fuel-profile overrides, map-size selection, and UI-to-terrain dependency direction.

Notes: The initial combined Randomise action was replaced by independent seed and slider actions on July 28, 2026.

Status: done

TSK-0168: Activate HQ squads directly from command hotkeys

Type: feature

Why: Fixed squad hotkeys selected only already-fielded command units, forcing players to open the HQ facility before they could dispatch an available squad into the world.

Done when:
- [x] Keys 1-5 map to the five persistent squad slots instead of the current fielded-unit ordering.
- [x] A fielded squad becomes selected immediately, while an HQ squad with available trucks becomes ready for the next mouse terrain order.
- [x] Bottom-tray squad activation follows the same behavior without changing HQ roster-management selection.
- [x] Unit regression coverage verifies HQ activation, mouse dispatch, fielded reselection, and empty-slot behavior.

Touchpoints: `src/ui/unit-control/`, `src/ui/phase/bindings/phaseBindingsRuntime.ts`, `scripts/units-regression.mjs`

Constraints: keep unit simulation independent from UI, preserve the five fixed squad slots, and do not move recruitment or roster maintenance out of the HQ facility.

Status: done

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
- [x] Terrain cutout cell edges split at every collinear retained vertex before triangulation, and mountain-rock geometric vertex morphing is removed from the T-junction mesh while fragment-stage rock color, bump, roughness, strata, and fractures remain.
- [ ] The supplied deterministic scene passes renewed live overhead and oblique inspection while paused and animated without white/black cracks, skirt segment gaps, surface crossings, z-fighting, or a restored river-mouth lip.

Touchpoints: `src/systems/terrain/rendering/inlandWaterRenderSurface.ts`, `src/systems/terrain/rendering/inlandWaterMeshBuilder.ts`, `src/systems/terrain/rendering/inlandWaterTerrainCutout.ts`, `src/systems/terrain/rendering/inlandWaterTerrainSeam.ts`, `src/systems/terrain/rendering/inlandWaterSeamDebugMaterial.ts`, `src/systems/terrain/sim/finalWaterfallClassifier.ts`, `src/systems/terrain/sim/basinLakeHydrology.ts`, `src/render/threeTestTerrain.ts`, `src/render/terrain/water/`, `scripts/terrain-water-regression.mjs`, `scripts/mapgen-regression.mjs`

Constraints: preserve deterministic river/lake masks, carved elevations, beds, surfaces, share codes, and saves; keep ocean separate; rebuild static geometry only with existing terrain/hydrology invalidation; add no per-frame sampling or draw calls.

Notes: The first two geometry repairs did not solve the reported scene. Production-path evidence from share code `MAP6-115-22002R2S1W1M152B0R1G1W2R2C1X1N1J141K0Y1M1A1E181Q0K1K12161C` showed why: the projection seam moved 73 original boundary vertices more than `0.02` cells, left three unmatched, and moved one by `0.795` cells while its post-snap metric misleadingly displayed roughly zero. The failed projection approach is replaced by direct terrain subtraction against immutable indexed water triangles. The same production case at its real `1.6105` height multiplier reports zero original displacement, unmatched vertices, seam T-junctions, unexpected open ends, segment gaps, skirt-joint gaps, and water-above-seam error. Ownership captures then separated three distinct defects. A continuous magenta skirt with a pale cyan-contact line proved uncovered raster/depth space, resolved by a fully submerged `0.04`-cell waterward guard. Pale slivers from the skirt top exposed mountain-rock vertex relief displacing shared seam vertices along different normals. The final overhead capture showed the remaining lines followed retained-terrain cell edges: the production half-edge audit found independently segmented T-junction edges and independently recomputed shader inputs. All retained polygon edges now split at collinear cutout vertices and share final world-position inputs. Geometric mountain-rock vertex morphing is removed because nonlinear displacement is inherently unsafe on this topology; fragment-stage rock color, bump/normal, roughness, strata, and fractures remain. Stride 1-4 fixtures invoke the production cutout and mesh builder. F11 cycles normal, ownership, water-without-FX, skirt-only, and water-only modes. Renewed normal paused/animated overhead and oblique acceptance remains open after the tile-edge correction.

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
TSK-0193: Instrument map-generation finalization substeps

Type: bug

Why: New-run generation could sit at 99% with a stale `Coloring terrain` label while final morphology, vegetation pre-growth, fuel initialization, color noise, or diagnostic publication performed unreported work.

Done when:
- [x] The loading state line identifies each finalization substep and reports vegetation pre-growth by year plus terrain-color generation by completed row.
- [x] Each completed finalization substep emits a console duration, with per-year vegetation timings and cumulative visited/changed tile counts.
- [x] Telemetry yields between major substeps and pre-growth years without changing deterministic map output, and diagnostics regression coverage checks ordered bounded finalization progress plus the expected messages.

Touchpoints: `src/mapgen/stages/FinalizeStage.ts`, `src/systems/terrain/sim/vegetationPreGrowth.ts`, `src/ui/loadingTips.ts`, `scripts/mapgen-diagnostics-regression.mjs`, `docs/GAME_DESIGN_REFERENCE.md`

Constraints: preserve deterministic seeds and generated output, keep UI dependencies out of terrain simulation, and avoid adding another mapgen stage solely for telemetry.

Notes: TypeScript and queue validation pass. The focused diagnostics run reached and passed the new expected-message, bounded/ordered finalization progress, and baseline-versus-finalization-reporter hash assertions. The broader script then failed its existing zero-pre-growth elevation invariant (`e3783012` versus `9fe7f7fc`) while river, lake, road-edge, and bridge hashes matched; that branch-level terrain drift is outside this telemetry change. Live localhost appearance remains unverified in this VS Code surface.

Status: done
TSK-0194: Instrument parallel 3D asset preload

Type: bug

Why: The new-run loading overlay showed the last completed asset family at 25% increments, so a stale `trees` label at 75% could mask which parallel loader was actually still running and how long it had been stalled.

Done when:
- [x] The loading state line refreshes every second and lists active, completed, and failed asset families rather than presenting the last completion as current work.
- [x] Tree GLTF and world-audio preload report individual filenames, unit counts, failures, and timings; family and total console telemetry identify the slowest loader.
- [x] Progress is weighted by the 26 actual preload units while cached callers remain compatible, and TypeScript plus a focused formatter smoke check pass.

Touchpoints: `src/render/threeTestAssets.ts`, `src/render/threeTestWorldAudio.ts`, `src/app/gameSessionRuntime.ts`, `src/ui/loadingTips.ts`, `docs/GAME_DESIGN_REFERENCE.md`

Constraints: keep the four asset families parallel, preserve loader caches and failure fallback behavior, and keep renderer/audio loaders independent of app and UI code.

Notes: Implemented from the supplied static loading capture. Live timing and layout remain pending a refreshed run because this VS Code surface cannot inspect localhost.

Status: done
TSK-0195: Bound GLTF preload work and expose blocking phases

Type: bug

Why: Refined preload telemetry still appeared frozen at `0s` with 14/16 trees complete because all sixteen tree GLBs plus the firestation were requested together, and GLTF parsing followed by bounds calculation and geometry/material cloning can starve the browser main thread and prevent the heartbeat from repainting.

Done when:
- [x] Tree loading uses at most two concurrent GLTF requests and yields one browser frame after each model is prepared while houses, firestation, and audio remain parallel families.
- [x] Tree and firestation status distinguish request, download percentage, parsing, and geometry preparation, and show up to two genuinely in-flight files rather than the last completed filename.
- [x] The loading explanation states that a paused timer identifies main-thread parsing/preparation starvation; TypeScript/build, formatter smoke, and queue validation pass.

Touchpoints: `src/render/threeTestAssets.ts`, `src/app/gameSessionRuntime.ts`, `src/ui/loadingTips.ts`, `docs/GAME_DESIGN_REFERENCE.md`

Constraints: preserve asset contents, seasonal tree material preparation, cache behavior, fallback behavior, and family-level parallelism; do not move Three.js objects across workers.

Notes: Static diagnosis used the supplied frozen `0s` capture plus local asset sizes. The remaining candidates included three 1.0–1.1 MB Maple GLBs, a 0.76 MB Elm GLB, and a 1.09 MB firestation GLB. Live timing and responsiveness remain pending a refreshed run because this VS Code surface cannot inspect localhost.

Status: done
TSK-0196: Profile post-asset 3D world construction

Type: bug

Why: The loading overlay could remain visibly frozen at 100% and continue describing completed assets while synchronous renderer initialization, terrain construction, or first-frame priming blocked browser repaint. Existing terrain telemetry collapsed inland-water cutout, skirts, vegetation, structures, and water preparation into one `fullBuild` duration, leaving no evidence for optimization decisions.

Done when:
- [x] Asset loading reserves progress for renderer initialization, terrain construction, runtime finalization, and first-frame priming, with a browser paint opportunity before each synchronous high-level stage.
- [x] Terrain build telemetry separately measures assembly, inland-water cutout, normals, material/texture work, vegetation, structures, water, and finalization, and remains visible in the runtime performance overlay.
- [x] Inland-water telemetry measures domain construction, clipping, seam construction, conformance, skirt emission, and buffer finalization with source, cut, boundary, seam, retained, skirt, and output geometry counts.
- [x] Copyable console profiles report renderer, tree-impostor-atlas, terrain-sync, terrain-build, cutout, and first-frame timings; TypeScript and the focused renderer regression pass.

Touchpoints: `src/app/gameSessionRuntime.ts`, `src/render/threeTest.ts`, `src/render/threeTestTerrain.ts`, `src/ui/loadingTips.ts`, `scripts/render-performance-regression.mjs`, `docs/GAME_DESIGN_REFERENCE.md`

Constraints: preserve generated terrain, water topology, render assets, deterministic instance placement, and existing renderer/domain dependency direction; measure before changing geometry algorithms or visual quality.

Notes: Implemented from the supplied static loading captures. Live timing, progress repaint behavior, and the actual dominant stage remain pending a refreshed run because this VS Code surface cannot inspect localhost. The console lines `[threeTest:startupprofile]`, `[threeTest:impostoratlas]`, `[terrainbuild]`, and `[terrainbuild:cutout]` are the evidence to capture before selecting an optimization.

Status: done
TSK-0197: Remove quadratic inland-water cutout lookup

Type: bug

Why: A supplied 256x256 startup profile measured 168.1 seconds for terrain construction, with 166.1 seconds inside inland-water cutout. Boundary association repeatedly scanned 5,440 contour segments and canonical conformance repeatedly scanned every seam vertex across 146,982 retained polygons. During that blocked work, the higher-stacked 3D overlay exposed a black world and HUD above the loading screen.

Done when:
- [x] Contour-boundary association uses a deterministic cell-bucket index instead of scanning every inland-water segment for each retained polygon edge.
- [x] Canonical seam vertex and along-edge lookup use quantized and cell-bucket indices instead of scanning every seam vertex during terrain conformance.
- [x] The loading overlay remains stacked above the mounted 3D runtime until terrain and first-frame preparation finish.
- [x] Focused water regression preserves canonical seams, split ordering, skirt topology, and retained-terrain closure while enforcing a generous supported-map cutout budget; renderer, TypeScript, build, queue, and diff checks pass.

Touchpoints: `src/systems/terrain/rendering/inlandWaterTerrainCutout.ts`, `src/systems/terrain/rendering/inlandWaterTerrainSeam.ts`, `src/render/threeTestTerrain.ts`, `styles.css`, `scripts/terrain-water-regression.mjs`, `scripts/render-performance-regression.mjs`, `docs/GAME_DESIGN_REFERENCE.md`

Constraints: preserve immutable water-contour coordinates, canonical seam segmentation, terrain/skirt UV and normal ownership, deterministic segment selection, and existing rendering dependency direction; do not remove the retained-terrain conformance safeguard without equivalent topology evidence.

Notes: The player-supplied profile showed skirt emission itself took only 14.8 ms despite 42,984 skirt triangles; the actual bottleneck was 65.1 seconds of clipping/boundary association plus 99.8 seconds of conformance lookup. After spatial indexing, the focused full-resolution fixture measured a 2.73-second cutout (472 ms clipping and 1.42 seconds conformance), about 59x faster than the supplied 162.3-second cutout, while the complete 37-case water suite finished in about 11.6 seconds. The player confirmed during implementation that the map loaded much faster with seams still correct. The loading-overlay stacking result still needs a refreshed live capture.

Status: done
