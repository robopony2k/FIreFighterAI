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
