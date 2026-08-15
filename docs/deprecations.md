# Deprecations

## Overlapping Response Trucks on Roads

Status: Deprecated as of August 15, 2026.

- Response trucks no longer advance through or finish movement on a road or bridge tile occupied or reserved by another response truck.
- Trucks now queue on their existing route and resume when the next road tile is vacated; temporary traffic blockage does not trigger pathfinding retries.
- Bases and off-road positioning retain their existing multi-truck behavior, and civilian evacuation continues using its separate road-slot traffic model.

Migration guidance:

1. Reserve road and bridge destinations before committing response-truck movement, including every waypoint crossed by a high-speed update.
2. Synchronize occupancy from committed truck positions after each truck moves so following vehicles can use newly vacated tiles deterministically.
3. Keep response-truck occupancy inside the units simulation domain rather than coupling it to evacuation traffic or road generation.

## Stationary, Off-Road, and Out-of-Season Firetruck Audio

Status: Deprecated as of August 15, 2026.

- A truck route or suppression target no longer qualifies a firetruck for engine/siren playback while it is stationary.
- Firetruck audio now requires committed movement during fire season, with both ends of the movement segment on a road or bridge tile.
- Paused, off-road, base, non-fire-season, and non-truck movement remain silent; existing active-fire proximity, attenuation, and occlusion behavior is unchanged.

Migration guidance:

1. Determine playback eligibility from committed previous/current unit positions rather than route intent or task assignment.
2. Require road or bridge occupancy at both segment endpoints so entering, leaving, and travelling off the road network cannot trigger the loop.
3. Keep this rule in the rendering/audio boundary; do not add audio state to unit simulation or persistence.

## Shared Pedestrian and Response-Truck Traversal Rules

Status: Deprecated as of August 15, 2026.

- Response trucks no longer reuse pedestrian terrain costs, signed raw-elevation slope factors, and unrestricted steep-surface passability.
- Truck routes now strongly prefer connected road edges, apply symmetric rendered-angle penalties, reject non-bridge segments at or above 38 degrees, and resolve unreachable orders to the closest reachable tile with a command alert.
- Firefighter foot movement and civilian evacuation's road-only routing remain unchanged.

Migration guidance:

1. Supply an explicit foot or vehicle movement profile when planning or advancing unit routes.
2. Keep response-vehicle tuning in the units domain and use the shared rendered segment-angle helper instead of raw elevation thresholds.
3. Do not restore imports from the retired transitional `src/sim/pathing.ts`; unit pathfinding now belongs under `src/systems/units/`.

## Sub-Quarter-Speed Incident Presets

Status: Deprecated as of August 15, 2026.

- Incident controls no longer expose the `0.015625x` through `0.125x` ultra-slow presets or cap playback at `0.25x`.
- Incident playback now offers `0.25x`, `0.5x`, `0.75x`, and real-time `1x`, with `0.5x` remaining the default selection.
- SIM Lab consumes that same four-value list without appending duplicate `0.5x` and `1x` entries.
- Strategic time controls, incident/strategic state isolation, and the internal incident fire-kernel pacing scale remain unchanged.

Migration guidance:

1. Treat `0.25x` and `1x` as the supported player-facing incident speed bounds.
2. Use the shared incident preset list instead of encoding retired fractional values in UI or simulation code.

## End-of-Batch Fire Incident Detection

Status: Deprecated as of August 14, 2026.

- Fire detection no longer waits until every internal substep in an accelerated strategic batch has committed.
- Fire-eligible high-risk work now uses bounded detection slices and polls after each slice.
- The first incident alert stops the batch and clears its remaining strategic fire backlog before pause or incident-speed continuation.

Migration guidance:

1. Keep fire-event detection inside the fire substep boundary rather than after the outer strategic step.
2. Do not carry pre-alert accelerated fire backlog into incident mode.
3. Preserve detection confidence and delay rules; the interruption occurs when those rules first emit an alert.

## Frame-Based Cluster Smoke Emission

Status: Deprecated as of August 14, 2026.

- Cluster-plume smoke no longer emits a fixed particle batch on every fire-render rebuild.
- Cluster anchors now accumulate emission from the same game-speed-scaled visual delta used for smoke movement and ageing.

Migration guidance:

1. Express fire-smoke emission as particles per scaled visual second.
2. Retain fractional emission carry between render rebuilds.
3. Keep adaptive frame caps as overload protection rather than as the primary emission clock.

## Distributed Campaign Starting Squads

Status: Deprecated as of August 14, 2026.

- Difficulty-granted starting trucks are no longer distributed across the emptiest HQ squad slots during campaign seeding.
- Every complete starting response team now belongs to the first HQ squad, allowing the opening roster to deploy as one command group.
- Ordinary post-start truck recruitment retains the existing emptiest-squad assignment policy.

Migration guidance:

1. Supply the first HQ squad explicitly while seeding campaign trucks.
2. Keep later recruitment and manual winter reassignment behavior unchanged.
3. Preserve reciprocal firefighter-to-truck crew assignment within each response team.

## Raw Multi-Glyph Chief Portrait Flame Field

Status: Deprecated as of August 14, 2026.

- Chief portraits no longer display the title shader's raw nearest-glyph bands, which exposed vertical noise-strength boundaries outside the title masks.
- Portraits now use a dedicated procedural field derived from the same noise/fBm basis, where independent emitters blend with a continuous wall layer instead of selecting a nearest glyph zone.
- Ember retires its flame emitters in favor of sparks and a faint lower glow; the remaining profiles use positive height envelopes at approximately 50%/75%/100% without exposing a horizontal cutoff pane.
- The portrait field uses the title renderer's heat-color curve rather than a separate red-heavy palette; the title screen itself remains unchanged.
- Clipped upward sparks are prewarmed across the frame so every profile reads immediately; Ember keeps a substantial slow, long-lived field, while density and rise speed increase toward Inferno.

Migration guidance:

1. Keep multi-glyph flame bands inside masked title artwork and use the portrait wall/emitter blend for unmasked picture-frame presentation.
2. Tune portrait height through its positive flame envelope rather than the title shader's fixed row-heat cutoff.
3. Drive future portrait emitter and spark changes through the shared ferocity dynamics instead of canvas scaling or independent difficulty branches.

## Difficulty-Scaled Chief Portrait Flame Surface

Status: Deprecated as of August 14, 2026.

- Campaign difficulty no longer resizes the rendered flame surface behind the selected Chief.
- The portrait canvas remains fixed while a portrait-owned dynamics profile changes emitter count, wall blend, lower glow, occupied height, heat, opacity, turbulence, motion rate, gust strength, spark rate, rise speed, and lifetime.
- The title screen retains its original multi-glyph shader API, masking, and existing appearance.

Migration guidance:

1. Pass normalized portrait ferocity through the title-flame dynamics resolver instead of transforming the canvas or draw rectangle.
2. Add future presentation tuning to the shared dynamics contract without rescaling UV or noise coordinates.
3. Keep these values presentation-only unless campaign difficulty scope is intentionally expanded.

## Fixed Single-Team Campaign Start

Status: Deprecated as of August 13, 2026.

- New campaigns no longer always seed exactly two firefighters and one truck.
- The New Game difficulty selection now derives a starting response-team count from a two-team baseline, with each complete team retaining one truck and two firefighters.
- Difficulty adjusts only initial budget and team count; existing Chief modifiers remain separately applied and all fire, weather, suppression, later-year economy, scoring, and unit-performance behavior remains unchanged.

Migration guidance:

1. Pass the campaign-resolved response-team count into roster seeding instead of assuming a fixed three-entry roster.
2. Add future difficulty values to the campaign difficulty catalogue rather than branching in UI, runtime, or units code.
3. Preserve the one-complete-team minimum unless the campaign validity rules are intentionally redesigned.

## Terrain-Stride-Coupled Forest Placement

Status: Deprecated as of August 13, 2026.

- Supported 256x256 terrain no longer discovers tree candidates only while walking the stride-two terrain-mesh sample lattice. That path could tint authoritative forest ground while never considering most forest tiles for a tree instance.
- Full-resolution vegetation planning now reserves visible coverage before optional density and keeps the 28,000 high-detail model ceiling. Any uncovered reservation uses deterministic chunked low-poly tree geometry without changing terrain type, fuel, succession, or saves.
- The guarantee applies only to the supported 256x256 campaign; larger experimental presets retain their existing sampled placement behavior.

Migration guidance:

1. Add future forest placement rules to the terrain vegetation planner rather than coupling them to terrain vertex traversal.
2. Preserve one-way simulation-to-render data flow; render budgets must not rewrite authoritative biome or fuel state.
3. Keep coverage fallback geometry inside the terrain vegetation root so annual refresh, disposal, season, and fire behavior stay coordinated.

## Centered Multi-Button Fire Alert Card

Status: Deprecated as of August 13, 2026.

- The centered fire card with Zoom to Fire, Open Town, Dispatch Squad, Open HQ, and Dismiss buttons is retired.
- New fire-front reports now publish through the typed notification event boundary and appear as bottom-screen toasts with only focus and dismiss actions.
- Fire-alert presentation no longer lives in the 3D renderer or in `WorldState`; fire simulation owns front/report lineage, the app bridges typed events, and notification UI owns preferences, timing, stacking, and rendering.

Migration guidance:

1. Register future notification types in the notification registry and publish a stable deduplication key through `notification:publish`.
2. Keep gameplay actions in their owning panels instead of adding workflow buttons to transient notifications.

## Shared Strategic Slider During Incident Time

Status: Deprecated as of August 12, 2026.

- Resolving the persisted 0x-20x strategic slider directly during incident mode is retired. It allowed a newly detected fire to continue at strategic speed even after the runtime switched to incident controls.
- Incident mode now always resolves from the existing dedicated incident presets. The strategic slider value remains stored and is restored when the incident ends.
- Incident UI surfaces show preset controls regardless of the persisted strategic control style.

Migration guidance:

1. Resolve active time through `getResolvedTimeSpeedValue`; do not read `timeSpeedSliderValue` as the incident rate.
2. Keep strategic and incident speed state independent when adding time-control surfaces.

## Overlapping Ephemeral Segment Quads and Node Discs

Status: Deprecated as of August 12, 2026.

- Emitting each ephemeral receiver link as an independent transparent quad and covering its endpoints with separate circular fans is retired. Overlap darkened internal joins and made every cell-centre chord visible as a separate segment.
- Each uninterrupted ephemeral branch now uses one indexed terrain-conforming strip with shared internal sections, bounded receiver-tangent interpolation, zero-width terminal taper, and a fade beneath permanent water at its downstream transition.
- The centreline may move only by a bounded deterministic cross-slope low-point adjustment derived from existing terrain. It does not alter receivers, create hydrology, add random wiggle, or avoid roads.
- Creek presentation sits below road decks where the two overlap. Future road-routing policy may handle undesirable valley co-location separately; creek rendering must not mutate or suppress authoritative drainage to solve it.

Migration guidance:

1. Add ephemeral geometry through `channelRibbonCenterline.ts` and the branch-strip builder rather than reinstating per-link transparent meshes or node caps.
2. Keep permanent stream/river contours on the canonical passing cutout path unless a replacement preserves exact seam topology and performance.
3. Preserve ephemeral non-water gameplay behavior and keep road-generation changes outside the creek-rendering boundary.

## Single-Threshold Raster Rivers and Fixed Cell-Support Contours

Status: Deprecated as of August 12, 2026.

- A single threshold that made every accepted drainage cell authoritative water is retired. The River stage retains established trunks, admits lower-flow branches only when their receiver chain anchors to a trunk or lake, and prunes short terminal twigs without adding coastal mouths.
- The fixed cell-support contour and dark bed-colour fill are retired for samples carrying channel downstream metadata. Permanent water now follows deterministic tapered capsules between original receiver-linked cell centres, with round confluence unions and four samples per cell; lakes remain unchanged in the shared indexed water/cutout contour.
- Ephemeral creeks are presentation metadata outside the authoritative river mask. They remain traversable and normally burnable, never become a water source, and use a separate seasonally wet terrain-draped ribbon with no terrain cutout.
- Orthogonal connector cells remain authoritative water support for gameplay continuity but carry class and width zero. Visible geometry follows the original diagonal receiver link directly, without random displacement, decorative wiggle, or renderer-derived hydrology.

Migration guidance:

1. Use `tileRiverChannelClass`, `tileRiverChannelWidth`, and `tileRiverChannelDownstream` as mapgen-owned presentation metadata; keep `tileRiverMask` authoritative for stream/river gameplay water.
2. Tune branch admission in `flowAccumulationRiverNetwork.ts`, channel widths in `riverChannelHierarchy.ts`, and seasonal ephemeral wetness in `ephemeralCreekRibbonMesh.ts`; do not derive competing hydrology in rendering.
3. Keep the legacy raster contour only as compatibility fallback for old saves and synthetic samples without downstream metadata.

## Lake-Overflow-Only Rivers and Rigid Spill-Contour Rejection

Status: Deprecated as of August 11, 2026.

- Visible rivers no longer depend on an accepted lake. The Erosion stage's deterministic receivers and flow accumulation now directly author channel extent, while accepted lakes intercept those channels and reconnect them through spill outlets.
- Eight-neighbour drainage remains the simulation routing model, but diagonal links are converted into deterministic orthogonal water cells before terrain, rendering, road, and connectivity consumers receive the river mask.
- A solved depression is no longer discarded solely because its natural spill contour is one tile short of the readable minimum. A bounded promotion may add only the lowest connected shore cells close to spill elevation; single-cell puddles are still not accepted as final lakes.
- Hydrology intensity still strengthens incision and increases direct channel extent, but its erosion contribution is limited so higher intensity does not systematically drain otherwise credible basins. Basin tendency also lowers the minimum viable lake depth without stamping water independently of priority-flood geometry.

Migration guidance:

1. Consume `flowAccumulation` and the final river mask instead of inferring that every river begins at a lake.
2. Preserve depression-first lake authority and the bounded 2-3 tile readable footprint; do not restore authored lake stamps or particle erosion.
3. Test direct-channel determinism separately from lake-overflow channels: zero intensity disables the former, while accepted lakes may still emit the latter.

## Late-Gated Island Falloff, Redundant Terrain Controls, and MAP6

Status: Deprecated as of August 10, 2026.

- Late `smoothstep` activation, squared edge influence, generic centre-upland/basin Gaussians, and the unused legacy coastline-envelope path are retired. They produced a raised interior slab followed by a narrow coastal wall and competed with named archetype fields.
- Low-frequency Surface terrain now receives a fixed `0.5` linear conversion toward the Red Blob square-bump target `1 - d`, where `d = 1 - (1 - nx²) × (1 - ny²)`. Fine detail is added afterward and fades only through the outermost six percent before the exact perimeter clamp.
- Border-water falloff (`islandCompactness`), interior land floor (`interiorRise`), sea-level bias, legacy `waterLevel`, `edgeWaterBias`, and compatibility-only `skipCarving` state are removed from active settings, recipes, presets, randomization, and editor controls.
- Sea Level chooses its threshold exclusively from Land mass and never reshapes Surface. Coast complexity may perturb the square-bump contour, but that perturbation vanishes at both the centre and perimeter.
- `MAP7` is the only supported terrain share-code format and serializes active fields only. `MAP6` and earlier formats are rejected; saved scenario objects are sanitized by ignoring retired properties rather than reproducing old terrain.

Migration guidance:

1. Regenerate terrain and issue a new `MAP7` code; do not translate removed values or reserved bits.
2. Tune broad identity with archetype, Relief, Max height, upland distribution, and the retained advanced archetype modifiers; use Land mass for coastline coverage.
3. Keep shared seeded noise authoritative for local Surface structure, apply named uplift and coastline plans only as bounded macro offsets, and add fine detail after island conversion.

## Archetype-Dominant Surface and Radial/Chebyshev Island Constraints

Status: Deprecated as of August 10, 2026.

- Treating the displayed archetype field as the dominant Surface elevation is retired. It caused Long Spine, Massif, and other identities to read as prescribed final geometry with noise merely painted over them.
- Radial distance produced generic circular islands, while the temporary `max(abs(x), abs(y))` correction produced a square pyramid. Neither is the Surface contract.
- Surface elevation is now led by seeded octave noise. Archetype uplift and basin tendency remain visible but bounded low-frequency biases, and the legacy coastline envelope is retained only as a smaller coastline-planning term.
- Island containment now follows the nonlinear square-bump distance formulation: noise remains authoritative inland, the boundary influence accelerates near the edge, contour noise breaks uniformity, and the exact perimeter is clamped for ocean topology. Surface and Sea Level use the same elevation field; Sea Level adds classification only.

Migration guidance:

1. Tune archetype amplitude as an uplift bias, not as a target mountain silhouette.
2. Preserve more correlation with Scenario noise than with Uplift inside the unaffected map interior while keeping named uplift direction or pairing measurable.
3. Do not replace the nonlinear boundary constraint with a radial dome, Chebyshev pyramid, or authored island outline.

## Preview-Only Uplift Contract and Archetype-Reseeded Surface Noise

Status: Deprecated as of August 10, 2026.

- The temporary preview-only Uplift contract is retired. It made archetype fields legible but left Surface dominated by a separately scaled octave heightfield, so the next editor stage did not visibly deform toward the shape it had just presented.
- The control-shaped archetype uplift and basin signal is now shared by Uplift and production Surface composition. It supplies a measurable bounded bias, while shared seeded noise remains the primary Surface elevation before erosion.
- Scenario noise no longer receives an archetype-specific seed offset. With other controls held constant, changing only the archetype applies a different deformation to the same initial noise rather than silently replacing that noise.
- Twin Bay's central basin is bounded so the stronger deformation retains a deterministic medium-map lake opportunity instead of expanding beyond the accepted lake footprint.

Migration guidance:

1. Treat Uplift as the broad deformation Surface will actually inherit, not as an exaggerated field inspector disconnected from production elevation.
2. Keep octave noise primary at Surface while retaining measurable axial, radial, paired, or shelf-scale uplift influence.
3. Preserve lake-prone basin area and depth when tuning deformation strength, and verify the focused deterministic hydrology fixture after terrain changes.

## Composite-Height Uplift Preview

Status: Deprecated as of August 10, 2026.

- The Uplift editor step no longer renders low-detail composite elevation dominated by generic octave noise. That presentation obscured the defining Long Spine, Massif, Twin Bay, Shelf, and None field structures even though their underlying uplift maps differed.
- Uplift now isolates archetype uplift and basin tendency on a shared nearly flat context surface, uses a diverging field overlay and near-overhead camera, and shows the coastline envelope as context rather than final terrain geometry.
- Surface remains the first step that combines archetype uplift with seeded terrain variation. Production terrain composition, archetype strengths, recipes, controls, and share-code data are unchanged by the preview-only presentation.

Migration guidance:

1. Judge archetype identity in Uplift by field direction, concentration, pairing, asymmetry, and basin placement, not by a finished mountain silhouette.
2. Use Surface when assessing the combined pre-erosion terrain, and Erosion or later stages when assessing final morphological consequences.
3. Keep `None` field-neutral and essentially flat in Uplift; do not reintroduce generic noise there merely to make the preview look terrain-like.

## Authored Crag Authority and Legacy Hydraulic Terrain Paths

Status: Deprecated as of August 10, 2026.

- Authored crag uplift, blocked/low-fuel footprints, crag-only shader fields, and crag-specific pathing or placement rules are retired. Mountains now emerge from broad archetype uplift followed by deterministic drainage, stream-power carving, sediment deposition, and talus relaxation.
- The unused coarse terrain generator, tectonic-proxy seed path, pre-river erosion path, and iterative hydraulic solver are removed. Terrain generation does not use particles or runtime hydraulic erosion.
- Historical completed crag tasks remain in `work_queue.md` as records of the superseded approach; they are not active design authority.

Migration guidance:

1. Express archetype identity through `archetypeUpliftField.ts`, not through final ridge, valley, cliff, or outcrop geometry.
2. Tune drainage and bounded material transfer in `drainageErosion.ts`, and derive exposed rock through `terrainMorphology.ts`.
3. Keep hard terrain boundaries for water topology and genuinely binary infrastructure/gameplay decisions; do not restore crag footprint authority or height-band mountain materials.

## Coarse-Carving Map Editor Model and Visible Bypass

Status: Deprecated as of August 10, 2026.

- The editor's Landform/carving and Surface/relief stage identities are retired. The authoring sequence now names broad Uplift and initial Surface conditions before deterministic Erosion.
- The shared new-run UI no longer exposes `skipCarving`; the coarse pre-river carving path it described no longer exists.
- The serialized `skipCarving` field and share-code bit remain readable and round-trip for compatibility, but have no terrain-pipeline effect and default to `false` in new workflows.
- Hydrology intensity is authored at Erosion because it controls drainage incision before the same value shapes the downstream Rivers/Lakes result.

Migration guidance:

1. Put archetype, Relief, Max height, upland distribution, landform alignment, and basin tendency under Uplift.
2. Put Ruggedness and surface frequency under Surface, and describe both as pre-erosion initial conditions rather than final mountain geometry.
3. Use the `terrain:elevation` and `terrain:erosion` snapshots for comparison; keep legacy debug-phase names only as accepted compatibility aliases.
4. Do not restore a carving bypass or add player-facing erosion controls without a new persistence and control-contract decision.

## Render-Only Continuous Crag Microterrain

Status: Deprecated as of August 6, 2026.

- The `surface-v1` batched microterrain overlay is retired. A supplied capture verified that it was active with 3,040 triangles, but its authority-safe 0.62-unit rise still read as smooth terrain at the strategic camera.
- Segmented crag crowns, ledges, and fracture gaps now modify authoritative elevation before hydrology. A two-bit footprint makes substantial crown/face tiles blocked and the wider formation rocky and zero-fuel.
- The normal terrain mesh now owns crag depth, shadows, silhouette, picking, and grounding. The deterministic crag field remains for ridge-oriented material evaluation and diagnostics, not independent geometry.

Migration guidance:

1. Tune authoritative crown segment length, crown width, relief amplitude, fracture gaps, and footprint thresholds in `craggyRidgeRelief.ts`.
2. Route gameplay exclusions through `tileCragFootprint`; do not infer collision from renderer output.
3. Keep water and infrastructure reconciliation in the terrain authority pass, and do not restore `cragSurfaceGeometry.ts`.

## Painted and Coarse-Vertex Crag Relief

Status: Deprecated as of August 6, 2026.

- Crag-specific parallax and fragment material as the primary source of relief remain retired because supplied captures showed a pale contour patch without convincing depth. Authority-gated stone color, bounded crevice values, talus blending, and distance-filtered fine normals may supplement the authoritative terrain geometry, but must not imitate silhouette or collision depth.
- Displacing the existing base-terrain vertices is also retired in source, but it was never emitted into the `dist` tree used for the follow-up capture and therefore did not receive valid visual evaluation. The continuous microterrain path supersedes it because it provides an explicit local topology and geometry budget.
- The immediate replacement was one batched terrain-conforming microterrain surface, which is now itself superseded by authoritative fractured ridge formations. Shader height and normal evaluation remain available only as developer diagnostics.

Migration guidance:

1. Tune authoritative crown and fracture formation parameters in `craggyRidgeRelief.ts`.
2. Do not treat screenshots from an unbuilt `dist` tree as evidence for or against a renderer revision; confirm the `surface-v1` marker before tuning.
3. Keep blocked and low-fuel behavior tied to `tileCragFootprint` rather than renderer geometry, and keep any supplemental final material free of parallax and fragment-depth writes.

## Instanced Crag Outcrop Geometry

Status: Deprecated as of August 6, 2026.

- All terrain-owned instanced crag geometry is retired, including the original tile-local clusters and the later multi-tile band variant. Supplied captures showed isolated black protrusions and scratch-like marks rather than coherent mountain geology.
- The current replacement is authoritative fractured ridge elevation plus `tileCragFootprint`; the normal terrain mesh supplies depth, shadows, and silhouette variation without returning to reusable asset piles.
- Share-code and save schemas remain unchanged, while movement, roads, settlements, fuel, vegetation, water reconciliation, and grounding now explicitly consume the authoritative formation or footprint. Fragment-depth writes remain disabled.

Migration guidance:

1. Tune authoritative crown segmentation, relief, ledges, fracture gaps, and footprint thresholds rather than reintroducing outcrop assets.
2. Keep material construction tied to the authoritative uplift field and keep gameplay exclusion tied to `tileCragFootprint`.
3. Extend the authoritative plan before pursuing any larger silhouette-changing formations.

## Disabled Grass Ground-Colour Detail Patch

Status: Deprecated as of August 4, 2026.

- The disabled `grassDetailFx` material patch and `ENABLE_GRASS_DETAIL_FX` flag have been removed; they only darkened tile edges and jittered ground colour without representing grass height, wind, curing, or depth.
- The replacement experiment is the FX-Lab-only terrain-domain volume compositor, which uses authoritative grass coverage and rendered terrain height without changing campaign rendering.
- No save, simulation, map-generation, fuel-profile, or campaign-rendering behavior changed during this replacement.

Migration guidance:

1. Develop and validate grass rendering under `src/systems/terrain/rendering/vegetation/` through the `grass-fidelity` FX Lab scenario.
2. Do not restore a core feature flag or terrain-material patch before the volume prototype passes live visual and performance review.
3. Keep future production integration separate from the FX Lab controls and preserve terrain-domain ownership.

## World-Spanning Grass Opacity Steps

Status: Deprecated as of August 14, 2026.

- Volume Clumps no longer divides the complete camera-to-scene world-box interval into 96/64/40 uniform samples. Strategic-camera gaps made individual occupied samples integrate far more than the thin canopy thickness and appear as stacked translucent panes.
- The replacement validates visible grass terrain, computes its local gradient, and backtracks through a padded, bounded canopy interval. Adaptive samples retain the existing ceilings but cap every opacity contribution at 0.065 world units.
- Both FX Lab grass variants now output premultiplied linear colour; the full-resolution composite owns the single tone-mapping and colour-space transform.

Migration guidance:

1. Keep future Volume Clumps sampling terrain-anchored and preserve the 0.065 integration ceiling unless a measured replacement proves equivalent stability.
2. Use March Work and Sample Spacing to diagnose work and grazing-ray undersampling rather than visualizing ownership across the full world-box path.
3. Do not restore per-sample display curves inside either grass-layer shader; colour transforms belong after scene compositing.

## Wind-Opposed Ocean Phases and Tick-Stepped Cloud Motion

Status: Deprecated as of August 3, 2026.

- Production ocean waves no longer combine a gameplay-wind direction with positive-time phase or positive wind texture offsets, which made visible crests and sampled normal detail move upwind.
- Cloud advection no longer exposes the fixed 0.25-second simulation cadence directly to sky uniforms; an allocation-free render clock now interpolates authoritative career time with simulation alpha.
- The direct MdXyzX reference retains its original unbiased phase, and neither cloud nor ocean motion introduces an independent wall-clock authority.

Migration guidance:

1. Use inverse sampling motion for textures and negative temporal phase for waves intended to travel along their supplied direction.
2. Interpolate cloud career time from consecutive authoritative simulation samples; do not integrate cloud travel from render-frame delta.
3. Apply production wind bias consistently to ocean height evaluation, raymarch hits, detail normals, and macro normals while keeping shoreline-normal surf independent.

## Fixed-Envelope Value-Noise Cloud Field

Status: Deprecated as of August 3, 2026.

- Seasonal clouds no longer blend the same symmetric vertical crown and shallow value-noise body across every season.
- That field turned fair cumulus into repeated horizontal ripples, kept winter clouds visually thin, and allowed autumn to read as heavier than winter despite different coverage values.
- The replacement uses climate-owned morphology profiles, cellular weather footprints, a Perlin-Worley volume atlas, weather-first empty-space rejection, and one bounded lighting probe per occupied slice.

Migration guidance:

1. Tune cloud base, depth, cumulus character, footprint scale, erosion, and shadow strength through `SeasonalCloudProfile` rather than adding season branches to the shader.
2. Keep broad placement independent of morph time; simulation time may gently warp internal detail but must not slide the volume vertically or reproject accumulated wind travel.
3. Preserve two WebGL-compatible 2D textures, manual atlas interpolation, the single sky draw, the fixed 20-slice ceiling, and matching CPU sun-occlusion density.

## Tri-Planar Heightfield Cloud Bodies

Status: Deprecated as of July 30, 2026.

- Projecting one 2D noise texture across XZ, XY, and ZY no longer supplies the internal seasonal-cloud density.
- Even with ray marching, a footprint-derived `localTop01` made silhouettes behave like smooth heightfields and produced flat pancake clouds.
- The replacement keeps a separate 2D weather map for placement and samples a deterministic padded 32³ RGBA atlas as a continuous trilinearly interpolated volume for broad density, billows, detail, and erosion.

Migration guidance:

1. Keep cloud count and large-scale placement in the 2D weather field.
2. Shape occupied footprints from the true 3D density signal and vertical layer envelope rather than calculating a per-footprint top height.
3. Preserve padded atlas slices, manual Z interpolation, matching CPU voxel sampling, and the two-texture single-draw resource contract.

## Reused WebGL Context With Stale Texture-Unpack Flags

Status: Deprecated as of July 29, 2026.

- Renderer initialization no longer assumes that a canvas-provided WebGL context has default pixel-unpack state.
- A disposed Three.js renderer could leave flip-Y or premultiplied-alpha enabled; reusing that context then made Three.js emit `INVALID_OPERATION` while creating its internal 3D and array fallback textures.
- The shared WebGL context boundary now clears both incompatible flags before constructing any new Three.js renderer.

Migration guidance:

1. Acquire 3D-mode, terrain-preview, and FX Lab contexts through `getRequiredWebGLContext`.
2. Reset incompatible pixel-unpack state before initializing a renderer on any context that may have been used previously.
3. Do not use a native 3D texture to address this warning; seasonal weather and the padded volume atlas remain ordinary 2D RGBA `DataTexture` resources.

## Instantaneous-Wind Lifetime Cloud Offset

Status: Deprecated as of July 29, 2026.

- Seasonal clouds no longer multiply the current wind direction by all elapsed simulation time or move opposite the wind because of texture-offset sign.
- That calculation reprojected the complete historical cloud offset whenever wind direction changed, producing visible sideways jumps and apparent jiggling during accelerated time.
- Rain-event seeds also no longer alter the underlying cloud track or morph phase; rain changes the continuous weather presentation without teleporting its formations.

Migration guidance:

1. Derive accumulated cloud travel from the stable world-seeded prevailing and seasonal direction field shared with gameplay wind.
2. Apply bounded continuous meander as a function of simulation career time rather than integrating render frames or reprojecting elapsed time.
3. Keep transient wind and rain changes in cloud coverage, density, height, lighting, and precipitation unless a persistent velocity integrator is introduced.

## Dense Small Fair-Season Cloud Field

Status: Deprecated as of July 29, 2026.

- Spring and summer no longer distribute their fair-weather coverage across many connected small or smeared formations.
- The replacement samples the broad weather field at a larger world scale and applies a nonlinear fair-coverage threshold, producing fewer substantial clouds with wider clear gaps.
- Local density is biased upward as global coverage falls, so reducing cloud count does not make the remaining cumulus faint.

Migration guidance:

1. Tune fair-weather count through global coverage and footprint threshold, not by reducing local body opacity.
2. Keep spring cloud occupancy materially above summer while preserving visible blue-sky gaps in both.
3. Verify that normal-speed pattern travel follows the displayed wind direction before judging motion only under time acceleration.

## Uniform-Top Cloud Footprint Slab

Status: Deprecated as of July 29, 2026.

- Broad 2D weather footprints no longer occupy one shared vertical profile from cloud base to a uniform slab top.
- A common top height turned otherwise volumetric ray-marched density into long horizontal shelves and smeared cloud bands at oblique viewing angles.
- Each footprint now derives a local top and crown from its broad billow and volume detail, retaining a coherent base while producing rounded, differently sized cloud bodies.

Migration guidance:

1. Keep coverage responsible for the number and footprint of formations, and local height responsible for their silhouette.
2. Preserve a continuous top fade wide enough for the fixed march budget to resolve without slice banding.
3. Inspect oblique horizon views as well as overhead views when tuning cloud height, footprint scale, or erosion.

## Stacked-Slice Pseudo-3D Cloud Noise

Status: Deprecated as of July 29, 2026.

- Interpolating offset 2D texture slices along the volume axis produced repeated diagonal streaks when shallow sky rays crossed many slices.
- Independent density opportunities along every ray also let sparse summer weather read as a continuous textured ceiling instead of separated cloud bodies.
- The replacement uses a rotated low-frequency horizontal weather map to gate whole cloud footprints, then shapes only those footprints with continuous tri-planar detail at a larger world scale.

Migration guidance:

1. Keep broad footprint coverage separate from internal body detail so low coverage creates clear gaps rather than thin noise everywhere.
2. Avoid stacked texture-slice interpolation for cloud volume reconstruction.
3. Check shallow-angle and horizon views for directional repetition whenever cloud scale or noise projection changes.

## Height-Indexed 12-Slice Cloud Field

Status: Deprecated as of July 29, 2026.

- The first seasonal-cloud upgrade sampled a 2D field at normalized height indices, so its nominal volume remained an extruded mask that read as translucent smears on the sky dome.
- Wind translated the mask but could not make cloud bodies develop or morph, and low seasonal density prevented sparse fair-weather clouds from forming opaque cores.
- The replacement intersects view rays with a bounded cloud slab, samples continuous pseudo-3D packed noise, scales extinction by path length, and moves simulation weather time through the third noise axis.

Migration guidance:

1. Preserve separate coverage and local-density behavior so sparse conditions reduce cloud count without making every remaining cloud translucent.
2. Keep cloud-base/cloud-top ray intersection and pseudo-3D sampling when tuning shape, lighting, or performance.
3. Validate future changes against live cloud-body volume and evolution, not only shader-source limits or static coverage values.

## Layered Planar Seasonal Cloud Shader

Status: Deprecated as of July 29, 2026.

- The seasonal sky no longer combines two planar noise layers with a nine-slice pseudo-volume overlay.
- A climate-owned packed-noise field and capped 20-slice front-to-back cloud march now provide rounded height profiles, detail erosion, self-shadowed interiors, and sun-facing highlights in the same sky-dome draw.
- Seasonal coverage, storm mood, wind drift, sun occlusion, and simulation-time pause behavior remain authoritative.

Migration guidance:

1. Keep seasonal cloud state, deterministic field sampling, shader source, and dome lifecycle under `src/systems/climate/rendering/`.
2. Preserve the packed weather and volume-atlas textures, single sky draw, fixed march cap, and early transmittance exit when extending cloud visuals.
3. Derive future cloud motion from climate weather time and wind rather than render-frame time.

## HQ-First Squad Dispatch Arming

Status: Deprecated as of July 29, 2026.

- Players no longer need to open the HQ facility before they can dispatch a staffed squad from headquarters.
- Fixed squad hotkeys 1-5 and the matching bottom-tray slots now activate both fielded squads and squads with available trucks at HQ.
- A fielded squad receives mouse terrain orders immediately; an HQ squad uses the same pointer gesture to enter the world.

Migration guidance:

1. Keep fixed squad-slot activation independent from whether the squad is currently fielded.
2. Route future squad command gestures through the bottom command tray and world pointer rather than adding an HQ-open prerequisite.
3. Leave recruitment, crew assignment, training, and roster maintenance in the HQ facility.

## Combined New-Campaign Seed And Slider Randomization

Status: Deprecated as of July 28, 2026.

- The single Randomise action that changed both the seed and terrain sliders is replaced by independent Randomise Seed and Randomise Sliders actions.
- The numeric seed now has its own editable field; Share Code is a separate field that continues to encode the seed, map size, and terrain variables together.
- Importing a valid share code updates the separate seed field and all encoded terrain controls.

Migration guidance:

1. Keep seed-only changes independent from slider-only changes.
2. Synchronize both inputs into the existing share-code format rather than introducing separate partial codes.

## New-Campaign Fuel Profile Editor

Status: Deprecated as of July 27, 2026.

- Fuel-profile fields are no longer displayed or editable in the new-campaign Terrain tab.
- Campaign setup continues to carry existing configured fuel-profile overrides unchanged; the Terrain randomizer does not modify them.
- Dev-facing fuel-profile tuning remains available in SIM Lab, which owns the intended tuning workflow.

Migration guidance:

1. Add fire-behavior tuning controls to SIM Lab rather than restoring the campaign setup grid.
2. Keep terrain randomization scoped to the displayed terrain recipe and seed while preserving map size and fuel-profile configuration.

## Full-World Static Batches And Full-Terrain Road Overlay

Status: Deprecated as of July 10, 2026.

- Vegetation and repeated structure instances are now partitioned into bounded 64-tile render chunks so the camera and shadow frusta can reject unseen regions without changing model detail or density.
- The road texture now uses sparse terrain geometry around road-bearing tiles instead of drawing a transparent copy of the complete terrain surface.
- The zero-weight shadow-blend light is hidden outside directional-light transitions, while both lights remain active for the existing smooth transition window.

Migration guidance:

1. Give new large static instance families spatial chunk bounds instead of disabling frustum culling or creating one world-sized batch.
2. Keep terrain overlays sparse when their visible coverage is sparse; do not restore full-surface transparent passes for roads.
3. Preserve the one-light steady state and use the existing blend controller when changing sun or shadow transitions.

## External Water And Watch Tower GLB Render Path

Status: Deprecated as of July 6, 2026.

- Runtime water towers and watch towers no longer load external GLB models for their 3D structure overlay.
- Water towers now render from a procedural settlement-owned model, and watch towers render from a procedural fire-detection model that scales height from tower level.
- The old GLB files may remain in assets for reference, but future tower visual work should extend the procedural builders rather than adding tower-specific model loaders.

Migration guidance:

1. Add new water tower visual details through `src/systems/settlements/rendering/proceduralWaterTowerModel.ts`.
2. Add new watch tower visual details through `src/systems/fire/rendering/proceduralWatchTowerModel.ts`.
3. Keep tower visuals render-only; do not route reservoir or detection gameplay through rendering modules.

## Committed Settlement Pre-Growth Years

Status: Deprecated as of June 20, 2026.

- Map generation no longer simulates 20 years of settlement expansion directly into the day-one world.
- The map-editor pre-growth control now advances deterministic vegetation succession and maturity only.
- Starting towns use a compact density-derived housing bootstrap, while the separate 20-year future-growth plan remains clone-only until construction consumes its recorded house and road entries.

Migration guidance:

1. Use `vegetationPreGrowthYears` for forest spread and maturity; do not route it into settlement generation.
2. Change starting-town population through the compact bootstrap policy and `townDensity`, not simulated historical growth years.
3. Keep future settlement road work in the precomputed growth plan and replay recorded paths when houses are constructed.
4. Future entries must retain their town's earlier road prerequisites so skipping an unavailable lot cannot leave later houses dependent on clone-only roads.
5. Failed future-lot searches must discard their trial roads completely; never attach speculative fragments to a later successful house.

## Default Road A* Exact-Target Routing

Status: Deprecated as of June 8, 2026.

- Default mapgen road routing no longer uses exact-target A* as the production connector planner.
- Road generation now uses a bounded, road-domain Dijkstra planner that can select the cheapest valid destination seed from existing road/network/access candidates.
- Runtime unit pathfinding is unchanged; this deprecation only covers mapgen-authored road generation.

Migration guidance:

1. Add future generated-road routing behavior through `src/systems/roads/sim/` planner boundaries and the `src/mapgen/roads.ts` adapter.
2. Keep runtime firefighter unit movement separate from road-generation route search.
3. Preserve deterministic seed output, bounded search budgets, diagnostics, and existing terrain-cost rules when tuning road connectors.

## Default Bidirectional Road Streamer Prototype

Status: Deprecated as of June 7, 2026.

- Default mapgen road routing no longer runs the bidirectional streamer prototype before every bounded A* attempt.
- Diagnostics showed the prototype doubled failed route searches on difficult terrain without fixing repeated bad connector selection.
- The streamer remains available as opt-in road-domain experiment coverage, but production routing should first reduce repeated connector attempts and improve route-candidate policy.

Migration guidance:

1. Do not enable streamer routing globally without proving generation time and road quality improve on diagnostics and mapgen regression cases.
2. Prefer changes that reduce bad connector candidates, repeated retries, and over-dense road skeletons before adding another solver layer.
3. Keep road planning deterministic and mapgen-authored; runtime settlement growth should consume replayed generated road paths where available.

## Direct River Count Generation Controls

Status: Deprecated as of June 1, 2026.

- Static river generation no longer starts from a requested river count or river budget.
- Visible rivers are now downstream overflow channels from accepted priority-flood lake basins.
- Legacy `riverCount` and `riverBudget` values remain readable for saved terrain data and share-code compatibility, but they do not choose river source count or topology.

Migration guidance:

1. Use rainfall, runoff, basin, and lake-outlet hydrology when adding future river behavior.
2. Do not reintroduce player-facing controls that directly request a number of rivers.
3. Keep compatibility parsing for stale `riverCount` and `riverBudget` values while treating them as ignored hydrology-generation inputs.

## Heuristic Fixed-Depth Inland Lake Selection

Status: Deprecated as of June 1, 2026.

- Static inland lake generation no longer starts from local depression scores and a fixed seed-depth flood guess.
- The replacement hydrology pass uses deterministic priority-flood basin detection, fills accepted enclosed basins to their lowest spill elevation, and routes overflow into generated river channels.
- Existing lake, outlet, river, and waterfall state fields remain supported; future hydrology work should preserve those baked terrain-generation outputs rather than adding runtime water simulation.

Migration guidance:

1. Add future inland lake behavior through `src/systems/terrain/sim/depressionBasinSolver.ts` and `src/systems/terrain/sim/basinLakeHydrology.ts`.
2. Keep lake surfaces tied to basin spill elevation instead of arbitrary seed depth.
3. Keep runtime terrain and hydrology immutable during live campaign play.

## Wall-Clock Weather FX Animation

Status: Deprecated as of May 30, 2026.

- 3D cloud drift and seasonal rain streak motion no longer advance from render-frame wall-clock time.
- Weather visuals now derive cloud and rain phase from simulation career time, seasonal rain seed, and wind, so pausing the game freezes weather like other gameplay-aligned visual effects.
- The replacement weather presentation is a ShaderToy-inspired local rewrite, not a direct source port.

Migration guidance:

1. Route future weather visual motion through climate rendering state derived from simulation time.
2. Do not add rain, cloud, or storm animation paths that depend only on `requestAnimationFrame` timestamps.
3. Keep new weather rendering helpers under `src/systems/climate/rendering/` unless they are truly generic render infrastructure.

## Runtime Settlement Terrain Elevation Edits

Status: Deprecated as of May 30, 2026.

- Runtime settlement growth no longer applies queued `terrainEdits` or plot-flattening elevation writes.
- Terrain shape, water masks, and hydrology are treated as static mapgen-authored runtime data; construction visuals adapt through structure grounding and foundations.
- Existing planned growth entries may still contain `terrainEdits` for compatibility, but runtime consumption treats them as no-op data and counts attempted use for diagnostics.

Migration guidance:

1. Keep terrain-height authoring in map generation, terrain tools, and debug labs.
2. Do not add runtime simulation code that writes `state.tileElevation` or `tile.elevation` for settlement construction.
3. Use structure grounding/foundation rendering for uneven runtime building sites instead of terrain flattening.

## Exposed 40x/80x Strategic Fast-Time Controls

Status: Deprecated as of May 30, 2026.

- Strategic fast time no longer exposes 40x or 80x presets, and the experimental slider no longer accepts values above 20x.
- Runtime frame budgeting still preserves requested-speed telemetry for stale/debug values, but effective strategic simulation speed is capped at 20x before any lower fire or runtime work cap is applied.
- 3D runtime simulation should yield while terrain or structure visual sync is pending, so future optimization work can distinguish actual simulation cost from render catch-up debt.

Migration guidance:

1. Use 20x as the maximum strategic fast-time target for player-facing controls, debug controls, and `Advance to Next Event`.
2. Add future high-speed pacing work through the app boot-loop budget and terrain visual-sync controller instead of restoring 40x/80x controls.
3. Treat any persisted or debug value above 20x as stale input that must sanitize or clamp to an effective 20x.

## Unbaked Planned Settlement Pads

Status: Deprecated as of May 21, 2026.

- Precomputed settlement growth entries now record the elevation edits made while flattening future house pads.
- Map generation applies those elevation edits to the real world immediately, so day-1 terrain already contains the landform needed for the 20-year settlement plan even though future houses and roads remain queued.

Migration guidance:

1. Keep future house and road visibility gated by the settlement growth queue.
2. Treat planned house-pad terrain as part of generated terrain, not as a runtime construction effect.
3. When changing plot flattening rules, update both queue recording and the day-1 terrain bake regression.

## Runtime Settlement Expansion Search

Status: Deprecated as of May 21, 2026.

- Growth-season town expansion no longer runs the full frontage, road-extension, and lot-reservation search as the default runtime path.
- Map generation now precomputes deterministic 20-year ideal settlement growth queues. Runtime construction consumes queued expansion lots and queued prerequisite road segments when approval-gated growth pressure allows it.
- Compatibility fallback may still reserve a lot at runtime for synthetic/debug worlds with no precomputed plan, but generated campaign maps should use the queue.

Migration guidance:

1. Add future settlement expansion behavior through `src/systems/settlements/sim/townGrowth.ts` plan generation and `src/systems/settlements/sim/townConstruction.ts` queue consumption.
2. Keep road mutation behind `SettlementRoadAdapter`; do not reintroduce direct runtime road search in construction scheduling.
3. Regression coverage should assert generated maps consume precomputed entries without reservation fallback during spring fast-time growth.

## Unbounded Rescue Road Routing Through Steep Terrain

Status: Deprecated as of May 20, 2026.

- Intertown road routing no longer uses near-unbounded rescue connectors that can cut straight through steep mountains or leave repeated failed connector fragments on the map.
- Road planning now scores rendered slope angle, prefers contour-following routes, can use a bounded set of non-town junction candidates, and applies compound junction/waypoint connectors atomically.
- Connectivity remains mandatory, but rare fallback routes are bounded, counted in regression metrics, and followed by final road-surface and rendered-footprint terrain reconciliation.

Migration guidance:

1. Add new intertown routing work through `src/mapgen/roads.ts` and the settlement road adapter boundary.
2. Keep settlement controllers free of direct road mutation details; use adapter operations for single and compound road carving.
3. Do not reintroduce rescue options with effectively unlimited grade, crossfall, or angle limits as the default connector path.

## Relief-Only Settlement Siting

Status: Deprecated as of May 20, 2026.

- Town and firebase placement no longer treat local elevation relief as sufficient proof that a location is buildable.
- Settlement placement now also scores rendered slope angle, prefers lower-angle town sites, and rejects steep individual house plots unless they can be flattened to an accessible pad.
- Foundations should remain trim visual supports over accepted pads, not large black terrain-repair blocks compensating for steep placement.

Migration guidance:

1. Add new settlement terrain-fit rules through `src/systems/settlements/sim/settlementTerrainFit.ts`.
2. Keep rendered slope-angle math in `src/shared/terrainSlope.ts` so terrain, biome, settlement, and regression code use the same conversion.
3. Do not reintroduce broad relief-only placement checks for towns, plots, or firebase siting.

## Accidental Inland Water Suppression

Status: Deprecated as of May 17, 2026.

- Inland water is no longer treated as ocean-solve drift to be removed before final rivers.
- The replacement path is the static hydrology network in `hydro:rivers`, where accepted inland lakes are generated from rainfall/runoff-weighted basins and integrated with river outlets and waterfall markers.
- Ocean classification remains owned by `hydro:solve`; lake water must stay distinct from connected ocean water unless future work explicitly adds coastal lagoons.

Migration guidance:

1. Add lake, outlet, or waterfall behavior through the static terrain hydrology modules, not ad hoc water tile cleanup.
2. Preserve water/fire invariants for every generated lake, river, and waterfall tile.
3. Keep dynamic water simulation and hydraulic erosion out of this phase unless a future design explicitly replaces the static hydrology model.

## Duplicated 3D Run Header Exit Controls

Status: Deprecated as of May 17, 2026.

- Normal 3D runs should expose one Main Menu action inside the command/progression counter.
- The old run header with separate End Run and Main Menu buttons created unused vertical space above the world and made two run-ending actions look more different than they were.
- FX Lab and SIM Lab may keep their header controls because they do not use the command/progression counter as the primary HUD surface.

Migration guidance:

1. Put future 3D run-level exit actions in the phase HUD progression action slot.
2. Keep app/session navigation behavior in the runtime layer; HUD components should only provide neutral attachment points.
3. Do not reintroduce a normal-run header above the 3D canvas unless it carries persistent, non-duplicated gameplay information.

## Truck-Mounted Autonomous Hose Suppression

Status: Deprecated as of July 5, 2026.

- Fire trucks no longer directly create hose streams or apply suppression from the vehicle body.
- The replacement path is crew-operated hose suppression: trucks carry water and firefighters, while deployed firefighters create the actual spray sources after boarding/disembark timing and hose-slot checks.
- Dual Line Operations unlocks a second crew-operated hose for sufficiently staffed trucks; under-crewed trucks now degrade through explicit driver and hose-readiness thresholds.

Migration guidance:

1. Add future suppression behavior through `src/systems/units/sim/` crew readiness, water, and firefighter suppression paths rather than truck spray targets.
2. Keep truck water/refill logic as reservoir support and keep hose visuals sourced from firefighter units.
3. Do not restore truck-body suppression as a tuning shortcut when firetrucks feel too strong; tune crew thresholds, hose slots, transition timing, and firefighter output instead.

## Fire-Task-Driven Autonomous Truck Repositioning

Status: Deprecated as of July 5, 2026.

- Suppress, Contain, Backburn, and stance changes no longer solve new truck positions or reboard crews just because the internal fire-task standoff changed.
- The replacement path is player-owned placement: Move, Deploy, Relocate, and Recall own truck movement and crew transition state, while fire tasks operate only from the placed truck envelope.
- Defensive behavior may still retreat a truck when its current tile is directly unsafe.

Migration guidance:

1. Add future truck movement behavior through placement commands and formation slot resolution, not through fire-task target selection.
2. Keep firefighter target and stance logic constrained to deployed crew positions within hose/tether range.
3. Surface `Deploy required` and `Out of range` feedback instead of silently moving trucks toward a fire-task solution.

## Redundant Per-Firefighter Hose Tethers

Status: Deprecated as of July 5, 2026.

- Deployed firefighters no longer each receive a truck-to-firefighter supply hose just because they are visible outside the truck.
- The replacement path is role-based deployment: drivers remain hidden in the truck, support crew take pump or assistant positions, and supply hose visuals are drawn only for active nozzle operators.
- Supply hoses should render with modest deterministic slack/curve so they read as unfurled hose, not high-tension wire.

Migration guidance:

1. Add future hose eligibility through unit crew-role and hose-slot helpers, not ad hoc render-side checks for every firefighter.
2. Keep pump/support firefighters visible for readability, but do not let them emit streams or consume water.
3. Tune hose visual shape in the rendering layer without changing suppression authority.

## Duplicated Right-Panel Unit Command Controls

Status: Deprecated as of May 17, 2026.

- Unit command ownership now belongs to the bottom command tray in the 3D runtime.
- Alpha/Bravo group selection, selected truck summaries, and command mode buttons should be presented together in that tray.
- The right-side dock should remain focused on fire risk, minimap, time/settings, and contextual widgets instead of duplicating unit command controls.

Migration guidance:

1. Add future unit command previews, queues, or command-mode affordances through the bottom tray.
2. Keep simulation authority in unit systems; tray UI may read state and dispatch existing command actions only.
3. Do not reintroduce command buttons into the right dock unless the design intentionally creates a distinct non-command widget.

## SVG Placeholder Chief Portrait Roster

Status: Deprecated as of May 16, 2026.

- The new campaign Command Roster now uses 496 x 496 PNG chief portraits instead of compact SVG placeholder portraits.
- Chief selection should present small selectable portrait icons with a larger selected-chief detail panel.
- Future chief portrait work should add or replace PNG assets under `assets/chiefs/` and route them through `src/core/characters.ts`.

Migration guidance:

1. Do not add new chief SVG placeholders for the roster.
2. Keep portrait asset paths in character metadata so UI code remains data-driven.
3. Preserve the icon-plus-detail selection pattern when adding future chiefs.

## Player-Facing Road Aggressiveness as Connectivity Fix

Status: Deprecated as of May 16, 2026.

- Initial map generation now treats firebase-to-town road connectivity as an invariant instead of relying on road aggressiveness or strictness tuning to overcome difficult terrain.
- Road strictness can remain as internal/debug tuning, but default campaign generation should automatically repair disconnected town road components.
- Switchback-style rescue routing and road terrain grading are the replacement path for hard terrain cases.

Migration guidance:

1. Add new initial road connectivity work through settlement road adapters and road edge masks, not loose tile adjacency.
2. Keep player-facing terrain controls focused on readable world shape rather than making players solve pathfinding failures.
3. Preserve road quality gates for edge masks, diagonals, and surface grading when changing connector behavior.

## Literal Daily Strategic Growth Stepping

Status: Deprecated as of May 16, 2026.

- Strategic vegetation growth no longer relies on every map block receiving the same small daily tick.
- Growth blocks now track elapsed career time and catch up in deterministic seasonal chunks, so large maps can run quickly without starving unprocessed regions.
- Settlement construction scheduling can skip passive days and jump to relevant cooldown or lifecycle events during high-speed strategic time.

Migration guidance:

1. Put new vegetation succession rules in `src/systems/terrain/sim/vegetationSuccession.ts` and keep `src/sim/growth.ts` focused on orchestration.
2. Treat `vegetationRevision` and `terrainDirty` as visual sync signals, not proof that every tiny canopy value changed on that exact tick.
3. Add future town-growth pacing to the settlement simulation modules instead of restoring one-day loops for high-speed catch-up.

## Binary Seed-Spread Forest Boundaries

Status: Deprecated as of May 14, 2026.

- Forest generation no longer treats the seed-spread `forestMask` as the primary visual vegetation boundary.
- Terrain vegetation now uses continuous tree suitability, probability, and density derived from moisture, elevation stress, slope stress, water influence, and seeded biome noise.
- The `forest` tile type remains the fuel category, but visual tree identity is assigned through clustered pine, oak, maple, birch, and elm stand patches.

Migration guidance:

1. Drive new vegetation placement from tree suitability/probability/density fields, not hard moisture/elevation thresholds.
2. Keep `forestMask` as a compatibility or broad-classification derivative only.
3. Keep tree species visual-only unless a future design explicitly adds species-specific fuel behavior.

## Center-First Firebase Placement

Status: Deprecated as of May 14, 2026.

- Firebase placement no longer accepts the exact map center just because it is dry.
- Settlement placement now scores central lowland candidates for dry buffer, local relief, moderate elevation, water distance, nearby vegetation, and roadability.
- The base remains near the center of the main island when viable, but it may move to a better nearby lowland site to avoid barren high terrain.

Migration guidance:

1. Route new firebase placement work through `selectBaseSite()` in the settlements simulation domain.
2. Keep terrain generation responsible for landform variety, not base-specific flattening.
3. Do not reintroduce center-first placement as the default campaign behavior.

## Primary Water-Level Terrain Authoring

Status: Deprecated as of May 9, 2026.

- The terrain editor no longer uses Water level as the primary coastline authoring control.
- Water now exposes Land mass as the player-facing control for target dry island coverage.
- Hydrology calibrates sea level automatically from the dry landmass and the Land mass target; Sea-level bias remains available as an advanced Water override.
- Existing saved scenarios and share codes may still carry `waterLevel` for compatibility, but new authoring should not depend on it.

Migration guidance:

1. Put coastline coverage decisions under `landCoverageTarget`.
2. Use `seaLevelBias` only for advanced post-calibration nudging.
3. Do not reintroduce raw Water level as the normal Water-step slider.

## Pre-Water Ocean Rendering in Early Terrain Previews

Status: Deprecated as of May 9, 2026.

- Scenario, Landform, and Surface previews no longer render ocean or water geometry.
- Dry landmass elevation is now established before Water resolves sea level and ocean classification.
- Water remains the first fast terrain-editor step that renders ocean; Rivers remains staged through `hydro:rivers`.

Migration guidance:

1. Put dry landmass feedback under Scenario, Landform, and Surface.
2. Put sea-level and coastline flooding feedback under Water.
3. Do not reintroduce ocean masks or water tile types into dry fast preview modes.

## Land Mass Control in Landform Preview

Status: Deprecated as of June 1, 2026.

- The map editor no longer exposes the Land mass slider under the Landform step.
- Landform is a dry height preview focused on elevation amplitude and local variation, not sea-level coverage calibration.
- Water owns the Land mass target because it is applied when sea level is calibrated and connected ocean is rendered.

Migration guidance:

1. Put height controls such as Relief, Ruggedness, Max height, and dry elevation shaping under Landform.
2. Put dry-land coverage, sea-level bias, coastline complexity, and border-water falloff under Water.
3. Do not reintroduce island-coverage target controls into the Landform step.

## Map Editor Skip Terrain Carving Control

Status: Deprecated as of May 6, 2026.

- The map editor no longer exposes `skipCarving` as an authoring control.
- Early terrain authoring now uses fast Landform, Surface, and Water previews backed by the shared noise landmass core.
- The saved scenario schema may still preserve `skipCarving` for compatibility, but new editor workflows should not depend on it.

Migration guidance:

1. Put landmass-shape tuning under Water controls: Land mass, coast complexity, island compactness, embayment, anisotropy, and asymmetry.
2. Put height tuning under Landform and ridge/surface tuning under Surface.
3. Keep final-quality erosion behavior behind the Erosion Detail preview step instead of reintroducing a skip-carving toggle.

## Alpha-Cut Ocean Terrain

Status: Deprecated as of July 12, 2026.

- Ocean-classified terrain is no longer made transparent to reveal the separate water surface.
- Below-water terrain now remains an opaque sand/rock seabed, while the ocean shader owns the continuous visible waterline and partial shallow-water coverage.
- Authoritative water cells, ocean connectivity, generated elevation, and sea level remain simulation/mapgen data rather than being rewritten for visual smoothing.

Migration guidance:

1. Do not restore ocean alpha holes in terrain textures or materials.
2. Put shoreline smoothing, shoaling, breakers, foam, and swash in the terrain/water rendering boundary.
3. Preserve opaque seabed coverage anywhere the water shader may fade or discard fragments.

## FX Lab Sine-Wave Terrain

Status: Deprecated as of July 12, 2026.

- The FX Lab no longer builds its shared synthetic world from global sine/cosine elevation waves with independently stamped shoreline and river geometry.
- A deterministic authored showcase map now provides coherent landforms, connected inland and coastal water features, representative terrain types, infrastructure, and protected dev-only editing boundaries.
- FX scenarios still load immediately and share one world; land edits can be reset or moved through versioned JSON presets without invoking production map generation.

Migration guidance:

1. Add future FX calibration landmarks to the canonical showcase-map boundary rather than rebuilding terrain inside the FX Lab controller.
2. Keep water topology and infrastructure protected from the lightweight land stamps.
3. Use production map generation only when validating mapgen itself, not as a prerequisite for rendering-effect tuning.

## Fast Rivers Preview

Status: Deprecated as of May 6, 2026.

- The map editor no longer renders Rivers through the fast landmass preview.
- Fast drainage accumulation remains available as a support field, but it must not be classified directly as visible river water.
- Rivers now advances to the accurate `hydro:rivers` stage and renders the carved channel snapshot.

Migration guidance:

1. Keep instant feedback focused on Scenario, Landform, Surface, and Water.
2. Route river authoring controls through staged mapgen previews instead of adding another fast river mask.
3. Preserve `RiverStage` as the source of visible river snapshots; current visible river channels come from lake overflow routing rather than fast drainage masks or direct river-count carving.

## Town Alert Progress-Only Evacuation

Status: Deprecated as of May 3, 2026.

- The old player-facing alert posture ladder no longer starts evacuation automatically.
- Town evacuation is now route-based: select a destination, preview the locked route, and issue the evacuation command.
- The old abstract `evacProgress` model is compatibility-only and should not drive new player-facing evacuation behavior.

Migration guidance:

1. Put new evacuation behavior under `src/systems/evacuation/`.
2. Keep simulation outcomes in evacuation sim/controller code, not render code.
3. Do not reintroduce route recommendation, route scoring, ETA, or survival forecast UI.

## WindFactor as Spread Bias

Status: Deprecated as of May 2, 2026.

- The fuel-profile `windFactor` key remains for compatibility, but its meaning is now windbreak strength.
- `0` means open terrain that does not meaningfully block wind; `1` means strong wind obstruction.
- Wind affects fire spread through the global wind model and deterministic ranged heat diffusion rather than source-fuel wind bias.

Migration guidance:

1. Tune `windFactor` as obstruction only: grass, roads, firebreaks, bare, water, and ash should normally be `0`.
2. Use `heatOutput` and `spreadBoost` for outgoing heat strength, not `windFactor`.
3. Clear or recreate old SIM Lab fuel-profile drafts because v1 drafts used the old wind-bias meaning.

## Unconditional Secondary Gap Diffusion

Status: Deprecated as of May 2, 2026.

- Secondary heat diffusion no longer bridges one-tile gaps unconditionally.
- Short gap crossing is now deterministic and gated by heat release, wind strength, wind alignment, weather spread/dryness, distance falloff, and intervening windbreak strength.
- Long-range probabilistic ember spotting remains out of scope for the current fire simulation.

Migration guidance:

1. Use SIM Lab 10m/20m/30m gap scenarios to tune ranged diffusion thresholds.
2. Keep roads and firebreaks non-flammable; raise their `windFactor` only if they should act as a wind obstruction.
3. Encode stronger fire-front pressure through fuel `heatOutput` and `spreadBoost`.

## Hidden Tile-Type Fire Modifiers

Status: Deprecated as of May 2, 2026.

- Fire behavior no longer adds forest-specific ignition resistance outside the fuel profile.
- Main-game fuel initialization no longer applies random vegetation fuel variance or fuel values above the profile `baseFuel`.
- Vegetation age still controls current available fuel in the campaign, capped by the tile type's profile `baseFuel`; SIM Lab assumes the active profile's full fuel load for tuning.
- Vegetation, canopy, town, and structure data may still drive rendering, growth, scoring, and pathing, but ignition and spread tuning should flow through explicit fuel profile fields and environmental inputs.

Migration guidance:

1. Encode desired forest, house, grass, scrub, or floodplain behavior directly in `src/config/fuelProfiles.ts`.
2. Use SIM Lab profile matching to compare terrain types without hidden tile-type fire offsets.

## YAML Fuel Profile Defaults

Status: Deprecated as of May 2, 2026.

- Fuel profile defaults are no longer sourced from `config/tile-profiles.yml`.
- The project now uses hand-authored TypeScript defaults in `src/config/fuelProfiles.ts`.
- SIM Lab profile tuning is static-server friendly: slider edits auto-save local drafts, and promotion to source is done by copying a complete TypeScript defaults file from the lab.

Migration guidance:

1. Edit or paste tuned defaults into `src/config/fuelProfiles.ts`.
2. Run `npm run build` when compiled `dist` output needs to reflect source defaults.
3. Do not reintroduce YAML/codegen for fuel profile tuning unless the runtime adopts a broader data pipeline.

## SIM Lab Fast-Forward Speed Slider

Status: Deprecated as of April 26, 2026.

- SIM Lab no longer exposes an arbitrary `0` to `12` speed slider.
- SIM Lab speed now uses discrete incident-time multiplier presets: the game incident-speed options plus `0.5x` and `1x` for lab usability.
- Saved scenarios with older `simSpeed` values are normalized to the nearest supported preset, with any value above `1x` loading as `1x`.

Migration guidance:

1. Use the discrete SIM Lab speed buttons when comparing fire behavior against incident-time pacing.
2. Treat `1x` as the maximum SIM Lab playback speed for baseline fuel-profile tuning.

## SIM Lab Three-Tile Road Gap

Status: Deprecated as of April 26, 2026.

- The Plain + Road SIM Lab template no longer uses a three-tile non-flammable road band.
- The template now uses a one-tile road gap to match the in-game road footprint while preserving the intended fire-jump test.
- Future SIM Lab templates that validate road or firebreak behavior should use game-scale tile widths unless they explicitly document a stress-test width.

Migration guidance:

1. Recreate old three-tile-gap experiments as saved custom SIM Lab scenarios if that wider gap is still needed for stress testing.
2. Treat the built-in Plain + Road template as the canonical road-scale jump test.

## Legacy 2D Renderer (`legacy2d`)

Status: Removed as of May 17, 2026. Previously deprecated as of February 16, 2026.

- 3D is now the only gameplay renderer.
- `?render=2d`, the runtime renderer setting, and the legacy 2D fallback path have been removed.
- Game-over and manual End Run flows now stay on the 3D runtime and show the end-run summary placeholder instead of exposing the old 2D canvas/phase UI.
- New rendering features should target the 3D backend only.

Migration guidance:

1. Prefer 3D runtime path and `threeTest`-backed rendering flows.
2. Use `src/ui/end-run/endRunScreen.ts` for terminal run presentation until the final end-run screen design replaces the placeholder.
3. Do not reintroduce 2D fallback behavior for WebGL failures; route users to menu/status recovery instead.

## Single-Frame High-Speed Fire Catch-Up

Status: Deprecated as of May 26, 2026.

- High-speed strategic fire work no longer attempts to process every accumulated fire substep in one frame.
- Fire runtime work now uses a bounded per-frame substep budget and carries deferred fire days as telemetry-visible backlog.
- Terrain visual sync distinguishes geometry, surface color, vegetation, structure, and fire-visual invalidation so ash/vegetation churn can be batched without hiding immediate structure changes.

Migration guidance:

1. Add future fire pacing changes through the fire runtime controller rather than expanding `stepSim` catch-up loops.
2. Use the perf overlay and runtime perf regression before tuning fire substep caps.
3. Keep terrain visual sync policy in the terrain controller and renderer modules focused on applying prepared samples.

## Runtime Path Search for Precomputed Settlement Expansion Roads

Status: Deprecated as of May 28, 2026.

- Generated settlement growth plans now record replayable road paths and bridge tile indices for queued expansion roads.
- Runtime planned expansion should replay recorded paths through the settlement road adapter instead of running A* or `carveRoadDetailed` during spring growth.
- Runtime path search remains a compatibility fallback for legacy or synthetic worlds with no recorded road path data, and fallback use is exposed through telemetry.

Migration guidance:

1. Regenerate campaign maps or growth plans so `SettlementGrowthRoadSegment` entries include `path` and `bridgeTileIndices`.
2. Consume generated settlement expansion roads through `carveRoadPath` or an equivalent replay adapter method.
3. Treat runtime settlement expansion path search as debug/legacy fallback only; investigate any fallback telemetry in generated campaign maps.

## Flat Command Reward Catalog

Status: Deprecated as of June 22, 2026.

- The prerequisite-free `rewardCatalog.ts` and `rewardStacks` campaign state have been replaced by a graph-backed tech tree and ranked `nodeRanks` state.
- Command upgrades still arrive through deterministic drafts, but draft candidates must now satisfy authored prerequisite ranks and capability unlocks are enforced by their consuming UI surfaces.
- Existing numeric upgrade effects and diminishing-return caps remain supported as ranked tech nodes.

Migration guidance:

1. Add future perks and unlocks to `src/config/progression/techTreeCatalog.ts` with stable graph and layout metadata.
2. Gate player-facing features through progression capability IDs rather than checking node IDs in UI or rendering code.
3. Use the progression graph helpers for eligibility, snapshots, and validation; do not recreate a separate flat reward pool.

## Separate Base Ops Selection and Per-Unit Deployment

Status: Deprecated as of June 30, 2026.

- Base Ops no longer has its own competing world banner or separate card.
- The physical base remains visible, but headquarters ownership is represented on the owning town with an `HQ` badge.
- Fire response deployment should flow through persistent HQ squads and the bottom command tray rather than deploying individual trucks or crews one by one from a Base Ops card.

Migration guidance:

1. Add future recruitment, training, squad, and dispatch controls to the HQ facility sidecar or the bottom command tray.
2. Keep non-HQ town panels focused on town commands such as evacuation.
3. Do not restore separate Base Ops click priority, duplicate Base Ops labels, or one-by-one truck deployment as the primary response workflow.

## Embedded HQ Controls in the Town Panel

Status: Deprecated as of June 30, 2026.

- The Town panel no longer embeds HQ squad, recruitment, or training controls below town information.
- Towns use one shared panel layout with town-level facts, actions, and a generic Facilities section.
- HQ is the first town facility type and opens in the reusable Facility sidecar; future functional buildings should register with the same facility UI mapping.

Migration guidance:

1. Keep town-level status and actions in the shared Town panel.
2. Add facility-specific operational controls to facility detail content, not directly to the Town panel.
3. Derive facility presentation from authoritative state and keep sidecar open/selected/tab state as UI-only state.
# Automatic three-level watch-tower siting and slab foundations

Status: Deprecated as of July 11, 2026.

- Watch towers are now sited by the player within their owning town's service boundary instead of choosing an automatic near-town tile.
- The former three-level ceiling is replaced by eight construction-backed levels with exponentially increasing upgrade costs.
- Full-width dirt/foundation slabs are replaced by independently grounded concrete piers at each structural leg.
- Future tower gameplay belongs in fire simulation placement/construction boundaries; tower meshes and radius overlays remain rendering-only consumers.
- Centre-tile-only slope checks, arbitrary tower rotation, duplicate model footing pads, sub-day construction, and maintenance-only upgrades are also obsolete. Placement now validates the shared four-leg footprint, towers are grid-aligned with one pier system, and each build or upgrade takes 90 days while upgrades may start in any phase.

## Separate Inland-Water Render Paths

Status: Deprecated as of July 16, 2026.

- Inland lakes no longer render through the ocean/standing-water mesh; rivers and lakes share one full-resolution inland-water contour and surface contract.
- The pale standalone river bank-wall mesh is replaced by terrain-material skirts attached to the clipped terrain geometry and overlapping the inland-water surface.
- Packed relative-height waterfall instances, disabled river-waterfall geometry, outer-bank waterfall wall matching, and the standalone waterfall helper are obsolete.
- Pre-carve waterfall feature labels are no longer authoritative after hydrology cleanup; final markers and lip/runout labels are rebuilt from final river/lake surfaces after lake absorption and outlet relocation.

Migration guidance:

1. Build terrain cutouts, inland-water geometry, lake joins, and waterfall anchors from `InlandWaterRenderSurface` transforms and world-space heights.
2. Pass typed `InlandWaterfallSpan` data to the inland mesh builder; do not reconstruct drops from normalized terrain or packed arrays.
3. Keep ocean rendering separate and allow only the controlled river-mouth overlap between ocean and inland-water domains.

## Endpoint-Only and Projection-Based Inland-Water Skirt Welding

Status: Deprecated as of July 22, 2026.

- Packed terrain-cutout endpoint arrays and nearest/exact-key height fallbacks no longer define inland-water closure geometry.
- Projecting or snapping full-resolution water vertices onto scalar-field terrain-cutout chords is also obsolete; post-snap near-zero error must not be presented as the original alignment error.
- The replacement treats the complete indexed lake/river contour as immutable XZ authority, subtracts its water triangles directly from terrain triangles, and splits both surfaces only at exact terrain-edge intersections.
- Shared seam vertices retain source-contour and terrain-triangle provenance and own the resolved terrain top, authoritative water height, skirt bottom, and retained-land UV.
- Exact coplanar contact alone is not considered sufficient depth coverage: closed skirt bottoms carry a measured, miter-jointed, fully submerged waterward guard strip in the existing terrain buffers. Do not restore projection or inflate the visible seam to hide raster pinholes.
- Applying procedural rock vertex displacement at or across the terrain cutout remains obsolete. Its T-junction topology cannot support nonlinear vertex morphing without separating long and subdivided tile edges. Crag relief now uses a separate locally subdivided surface selected only after validity has excluded the water domain; retained terrain edges must still be split at every collinear cutout vertex before triangulation.
- Closed-bank vertex displacement fades to zero at the seam; river-mouth opening segments remain skirt-free and retain their ocean hand-off behavior.

Migration guidance:

1. Pass `InlandWaterTerrainSeam` through the terrain rendering boundary and build it from `inlandWaterTerrainCutout` intersections instead of adding parallel packed boundary arrays or projection fallbacks.
2. Diagnose original-boundary displacement, segment-level XZ error, unmatched vertices, T-junctions, open ends, degenerate boundary triangles, skirt joints, height ordering, measured guard overlap, and render-only lift rather than relying on endpoint-only or post-conformance metrics.
3. Keep seam topology static and rendering-only; do not repair visual gaps by changing hydrology, water surfaces, terrain generation, save data, or draw-call structure.

## Post-Sea-Level Shoreline Topology and Elevation Rewrites

Status: Deprecated as of July 22, 2026.

- The downstream shoreline phase no longer recomputes ocean surface level, displaces or smooths the ocean mask, expands flooding, or stamps fixed beach and shelf elevation bands after Water has solved the coast.
- Water now exclusively owns resolved sea level and edge-connected ocean membership; coast metadata, rivers, lakes, biomes, roads, finalization, and rendering consume that boundary.
- Road-lake shoulder grading no longer raises authoritative water cells while terracing nearby land.
- Regenerating an existing share code may intentionally change baked terrain and static hydrology, while already-saved worlds retain their stored terrain.

Migration guidance:

1. Add future beach, headland, shelf, and cliff morphology to upstream terrain generation before Water calibration.
2. Keep `terrain:shoreline` limited to coast distance and beach/cliff/shelf classification.
3. Do not repair shoreline visuals by changing sea level, ocean membership, lake beds, or river topology downstream.

## Dry-Beach Coloring for Authoritative Ocean Cells

Status: Deprecated as of July 22, 2026.

- Ocean shelf and deep-ocean terrain no longer reuse the same dry-beach ground color as playable beach land.
- Authoritative shelf cells remain Water and retain their six-cell shoaling metadata, but their sandy seabed cools and darkens seaward beneath a minimum translucent water layer.
- Dry beach color remains reserved for dry beach cells; river and lake ground-color behavior is unchanged.
- The ocean renderer no longer estimates its surface from the upper quartile of seabed elevations when Water's authoritative sea-level field is available.

Migration guidance:

1. Derive submerged seabed color from sampled coast class and distance without adding a simulation tile type.
2. Keep minimum shelf-water coverage gated to the positive, seaward side of the signed shoreline.
3. Do not narrow the visual beach by moving the ocean mask or reclassifying authoritative water as land.
4. Render the ocean at Water's supplied sea level; retain seabed estimation only for legacy or synthetic samples without that field.

## Static Weather-Insensitive Ocean Shelf Treatment

Status: Deprecated as of July 22, 2026.

- Authoritative shelf water no longer uses one fixed opacity floor and near-shore tint regardless of conditions.
- The existing ocean shader now keeps clear-weather shallows visibly blue-green and submerged, then adjusts wave energy, foam, coverage, and clarity from cached wind and active-rain context.
- Seasons continue to own palette and lighting changes; they do not independently create rough water.
- The replacement adds no surf mesh, particle layer, texture sampler, render pass, or per-frame terrain sampling.

Migration guidance:

1. Feed normalized rendering context through the water-system boundary rather than importing climate state into the ocean renderer.
2. Keep shelf coverage gated by positive shoreline distance, seaward transition support, and authoritative ocean coverage.
3. Extend the existing signed-distance breaker and swash logic instead of adding a separate shoreline FX renderer.

## Fixed 12-Band Flat-Normal Distant Ocean

Status: Deprecated as of August 3, 2026.

- The temporary distant-ocean spectrum that summed 12 fixed directional bands and applied their normal to a flat carrier is removed.
- Pixel-footprint octave removal could reduce aliasing in that path, but it could not reproduce the short, displaced, derivative-dragged crests of the approved MdXyzX reference and retained visibly coherent grooves.
- The coarse 1,456-triangle carrier remains; production fragments now reconstruct a bounded MdXyzX height-field hit and normal, while the specialised coastal surface retains shoreline displacement, breakers, foam, masks, and shallow-water treatment.

Migration guidance:

1. Extend the shared MdXyzX wave core and production raymarch adapter rather than adding another fixed sine-band spectrum or tiled distant normal map.
2. Keep quality and pixel-footprint limits in the render layer, but keep normal calming separately bounded so surviving broad slopes remain visible.
3. Blend the raymarched surface through the signed coastal transition; do not replace shoreline authority or alter terrain, hydrology, saves, or simulation state.

## Unbounded Strategic-Ocean Normal Flattening

Status: Deprecated as of August 3, 2026.

- MdXyzX production normals are no longer forced completely vertical once hit distance exceeds roughly 82.6 world units.
- Pixel footprint still removes frequencies before they become sub-pixel, but lost close-scale contribution is replaced by a lower-iteration, broader-domain slope evaluation from the same MdXyzX function.
- Far normal calming is footprint-driven and capped, while horizon reflection, Fresnel, glitter, and specular suppression retain enough response for broad slopes to remain readable.

Migration guidance:

1. Treat frequency filtering and normal flattening as independent operations; do not use an unbounded distance term as a normal-variance multiplier.
2. Add strategic variation by evaluating the shared wave character at broader scale, not with fixed sine tables, tiled normal maps, denser geometry, or brightness-only compensation.
3. Keep macro/detail blending continuous in fragment shading and preserve the signed coastal transition and coarse carrier.

## Uniform Tile-Local Tree Placement

Status: Deprecated as of August 5, 2026.

- Forest occupancy and structure no longer come from independent tile hashes plus uniform within-tile jitter.
- Map generation now derives deterministic vegetation exposure, shelter, curvature, drainage, coast response, site quality, coherent stands, and retained clearings from final static terrain and seeded climate.
- Campaign succession reuses the same immutable terrain response, while render-only tree candidates use seeded blue-noise templates and globally fair instance-budget thinning.
- Fuel authority remains tile type, visible static moisture, vegetation age, and configured fuel profiles; tree transforms and species do not add hidden fire behavior.

Migration guidance:

1. Add future vegetation distribution rules to the terrain simulation scoring boundary, not directly to the renderer.
2. Keep exact tree transforms render-only and deterministic from prepared vegetation state plus world seed.
3. Use precomputed or cached O(n) terrain fields; do not introduce per-frame distance, raycast, or neighborhood searches.

## Tall-Tree Rendering from Grass Structure

Status: Deprecated as of August 5, 2026.

- Grass canopy cover and stem density no longer cause the terrain renderer to emit scrub-shaped tree instances.
- Tall-tree candidates now come primarily from forest tiles; scrub and floodplain retain limited, visually subordinate woody accents while grass remains ground vegetation.
- This is a render-authority correction only: grass biome, moisture, vegetation age, fuel load, and fuel profiles remain authoritative and unchanged by tree-instance placement.

Migration guidance:

1. Treat open-biome canopy and stem values as vegetation structure, not an automatic request for tree models.
2. Add future low vegetation through grass or scrub rendering paths instead of routing it through tall-tree placement.
3. Keep visual candidate weights deterministic and separate from fuel or biome rules.

## Routed and Iteratively Repaired Static Hydrology

Status: Deprecated as of August 11, 2026.

- The second priority-flood basin solve, rainfall/runoff candidate scoring, minimum-footprint promotion, lake-overflow routing, waterfall classification, lake-adjacent absorption, detached-component repair, and authoritative lateral river widening are no longer part of map generation.
- Cumulative per-cell river-surface descent is removed because it produced deep straight-sided channels and fragmented aqueduct-like water surfaces.
- The replacement reuses erosion's existing priority-flood depression depth, thresholds its existing flow accumulation once, and derives every water surface locally in one linear River stage.

Migration guidance:

1. Add future river abundance by changing the accumulation threshold, not by splicing, widening, or validating route fragments.
2. Add future lake abundance by changing the depression-depth threshold, not by promoting arbitrary shore cells or rerunning basin hydrology.
3. Keep waterfall and overflow metadata empty unless a future simple morphology rule can derive it without routing or iterative cleanup.

## Continuous Runtime Vegetation Block Succession

Status: Deprecated as of August 11, 2026.

- Growth season no longer repeatedly advances 16x16 vegetation blocks, maintains per-block catch-up clocks, or flushes canopy/stem visual changes every 30 simulated days.
- Runtime growth is one deterministic annual linear pass: forest fuel accumulates toward carrying capacity, disturbed ground can recover, and sparse recruitment is restricted to the existing forest edge.
- Fuel-only changes update authoritative fuel data without incrementing terrain or vegetation revisions; map-generation pre-growth retains the full visual succession model in explicit year units.

Migration guidance:

1. Add campaign fuel-risk tuning to the annual terrain simulation operation, not a per-frame or per-block loop.
2. Trigger vegetation rendering only for annual tile-type recovery or recruitment, never for fuel-only accumulation.
3. Keep broad canopy maturation and stand formation in map generation unless a future feature demonstrates a clear player-visible runtime need.

## Fuel-Only Visually Static Annual Vegetation Growth

Status: Deprecated as of August 11, 2026.

- The fuel-only, sparse-edge-recruitment behavior introduced by `TSK-0190` no longer defines campaign vegetation growth. Forest and shrub structure now visibly matures during the same annual event, and woody vegetation can encroach through grass, floodplain, and shrub stages.
- Runtime processing remains one deterministic O(n) annual pass. Pre-event woody occupancy is snapshotted so recovery and establishment cannot cascade through multiple ecological stages in one year.
- Forest and shrub fuel capacity is age-scaled, type transitions retain existing fuel, and deterministic render-only cohorts preserve young trees inside mature stands without adding per-tree state or raising the 18,000-instance budget.

Migration guidance:

1. Tune campaign succession through the annual terrain-domain probabilities, suitability threshold, age gains, and fuel catch-up rate rather than restoring per-tick block growth.
2. Batch age, canopy, stem, or tile-type visual changes into one vegetation revision after the annual pass; keep genuinely fuel-only mature years render-free.
3. Preserve the suppression-success/late-risk loop: untreated viable connected land should close into mature forest over a 15-20 year campaign, while fire should impose a multi-year recovery delay.

## Separate 3D Score and Progression Cards

Status: Deprecated as of August 11, 2026.

- The temporary score-only collapse control and independently framed Budget, progression, and score cards no longer define the 3D top-left HUD.
- One operational-summary widget now owns a permanent Main Menu / Score and Budget / pin and `x` header, with dock-compatible collapsed/hovered Compact behavior and pinned Full scoring counters.
- Collapse state remains run-local and resets to Full for a new run.

Migration guidance:

1. Add future always-available run actions or headline values to the unified header.
2. Add progression-level detail to Compact mode and dense operational counters to Full mode rather than creating another top-left card.

## Pause-Disabled Fires Retaining Strategic Speed

Status: Deprecated as of August 13, 2026.

- `Pause on Fire` no longer decides whether a detected fire enters incident mode; it controls only the paused/running state after that transition.
- Every detected fire now stops Advance to Next Event, preserves the strategic speed for restoration, and engages the dedicated incident-speed preset.
- Turning the setting off continues the detected incident at slow incident time without pausing.

Migration guidance:

1. Treat fire detection, incident-mode entry, and optional pausing as separate decisions.
2. Keep pre-detection strategic fire work bounded by the existing runtime cap; do not use the pause preference to retain strategic speed after detection.
3. Explain future event toggles in terms of the single behavior they control.

## FX-Lab-Only Volume Clumps Constraint

Status: Deprecated as of August 15, 2026.

- The corrected Volume Clumps grass compositor is no longer restricted to the FX Lab after the user approved an opt-in campaign setting.
- Campaign use remains disabled by default and consumes authoritative grass fuel and tile moisture instead of FX Lab length, curing-cycle, or diagnostic controls.
- The PCG SDF comparison and all grass diagnostics remain FX-Lab-only.

Migration guidance:

1. Gate campaign grass through the persisted `volumetricgrass` graphics setting; do not make the pass unconditional or tie it to a quality preset.
2. Feed campaign appearance from the render-only fuel/dryness property texture without adding shader state to saves, share codes, or simulation data.
3. Keep experimental variants and tuning controls in FX Lab until separately approved for campaign use.

## Static-Local Campaign Grass, Single-Solid Scrub, and Forest-First Model Allocation

Status: Deprecated as of August 15, 2026.

- Campaign grass no longer holds one year-round height and curing colour from fuel plus static tile moisture alone.
- It now combines fuel with the interpolated seasonal growth envelope and uses the terrain renderer's climate-dominated local/global dryness blend.
- Scrub that exceeds the native tree-model budget no longer uses one doubly tinted icosahedron; one correctly tinted multi-lobe instanced shrub retains the bounded fallback path.
- The shared model ceiling is no longer filled entirely by forest before scrub coverage is considered. Loaded native scrub assets receive a bounded reservation within that same ceiling, and displaced forest instances use the existing forest-coverage fallback.

Migration guidance:

1. Keep fuel authoritative for local grass quantity while treating seasonal growth and climate dryness as render-only presentation inputs.
2. Reserve native scrub slots inside the existing shared tree budget; reuse the bounded procedural scrub geometry only when the asset is missing or the scrub reservation overflows.
3. Do not restore multiplicative base and instance tinting on vegetation fallbacks.

## Quarter-Unit Grass-Length Ceiling

Status: Deprecated as of August 15, 2026.

- The `0.25` final local grass-length ceiling no longer defines either FX Lab Volume Clumps or the opt-in campaign grass renderer.
- Both paths now share a `0.6` maximum while retaining fuel, season, deterministic local variation, and the existing terrain-anchored march integration rules.

Migration guidance:

1. Use `GRASS_VOLUME_MAX_LENGTH` as the single rendering ceiling and keep the FX Lab control bound and regression synchronized with it.
2. Do not introduce a separate campaign maximum unless performance or visual evidence justifies intentionally diverging the two paths.

## Winter-Wrap Deciduous Foliage Reset

Status: Deprecated as of August 15, 2026.

- Multiplying annual season progress by per-tree rate jitter and applying autumn-only leaf loss no longer defines tree foliage. That phase reset restored full deciduous crowns at the start of winter and provided no spring leaf-out transition.
- Detailed trees and impostors now share one render-only phenology function: autumn loss reaches dormancy before the wrap, winter preserves that endpoint, and spring restores foliage gradually.
- Pine remains evergreen, hardwoods retain the existing sparse winter rendering floor, and scrub uses one 45% deciduous strength in both representations.

Migration guidance:

1. Tune leaf-out, leaf-drop, winter floor, and species strength in `treeSeasonPhenology.ts` rather than adding representation-specific shader curves.
2. Preserve `fract(season + phaseOffset)` periodicity and do not restore multiplicative annual-rate jitter.
3. Keep phenology rendering-only; do not add foliage phase to simulation, fire behavior, saves, or seasonal colour palettes.
