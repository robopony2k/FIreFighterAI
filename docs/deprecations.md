# Deprecations

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
