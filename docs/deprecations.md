# Deprecations

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
- Shape now exposes Land mass as the player-facing control for target dry island coverage.
- Hydrology calibrates sea level automatically from the dry landmass and the Land mass target; Sea-level bias remains available as an advanced Water override.
- Existing saved scenarios and share codes may still carry `waterLevel` for compatibility, but new authoring should not depend on it.

Migration guidance:

1. Put coastline coverage decisions under `landCoverageTarget`.
2. Use `seaLevelBias` only for advanced post-calibration nudging.
3. Do not reintroduce raw Water level as the normal Water-step slider.

## Pre-Water Ocean Rendering in Early Terrain Previews

Status: Deprecated as of May 9, 2026.

- Scenario, Shape, and Relief previews no longer render ocean or water geometry.
- Dry landmass elevation is now established before Water resolves sea level and ocean classification.
- Water remains the first fast terrain-editor step that renders ocean; Rivers remains staged through `hydro:rivers`.

Migration guidance:

1. Put dry landmass feedback under Scenario, Shape, and Relief.
2. Put sea-level and coastline flooding feedback under Water.
3. Do not reintroduce ocean masks or water tile types into dry fast preview modes.

## Map Editor Skip Terrain Carving Control

Status: Deprecated as of May 6, 2026.

- The map editor no longer exposes `skipCarving` as an authoring control.
- Early terrain authoring now uses fast Shape, Relief, and Water previews backed by the shared noise landmass core.
- The saved scenario schema may still preserve `skipCarving` for compatibility, but new editor workflows should not depend on it.

Migration guidance:

1. Put landmass-shape tuning under Shape controls: coast complexity, island compactness, embayment, anisotropy, and asymmetry.
2. Put ridge and height tuning under Relief controls.
3. Keep final-quality erosion behavior behind the Erosion Detail preview step instead of reintroducing a skip-carving toggle.

## Fast Rivers Preview

Status: Deprecated as of May 6, 2026.

- The map editor no longer renders Rivers through the fast landmass preview.
- Fast drainage accumulation remains available as a support field, but it must not be classified directly as visible river water.
- Rivers now advances to the accurate `hydro:rivers` stage and renders the carved channel snapshot.

Migration guidance:

1. Keep instant feedback focused on Scenario, Shape, Relief, and Water.
2. Route river authoring controls through staged mapgen previews instead of adding another fast river mask.
3. Preserve `RiverStage` and `carveRiverValleys()` as the source of visible river channels.

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

Status: Deprecated as of February 16, 2026.

- Default runtime backend is now `3d`.
- The legacy 2D renderer is still available only via explicit query flag: `?render=2d`.
- When `?render=2d` is used, the app logs a one-time warning that 2D is deprecated.
- New rendering features should target the 3D backend only.
- Legacy 2D is planned for removal in the next major refactor cycle after compatibility soak.

Migration guidance:

1. Prefer 3D runtime path and `threeTest`-backed rendering flows.
2. Treat `src/render/legacy2d/` as compatibility-only.
3. Keep behavior parity fixes in 2D minimal and avoid adding new feature work.
