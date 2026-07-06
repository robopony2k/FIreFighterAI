# Deprecations

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
