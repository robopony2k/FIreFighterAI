# Firefighter AI - Game Design Reference

Purpose: A concise, editable reference for the overall game loop, systems, and intended player experience. This document is meant to evolve with the design.
Story: You are the new "Fire Warden" in charge of a region. Your mission is to protect and serve the people throughout your career. Will you be the greatest fire warden of all time and a true hero, or will your leadership be so inept that you are fired for incompetence?

## High-Level Vision

- A strategic fire-response simulation with long-term planning and tactical firefighting.
- Climate drives the world instead of fixed seasons; "seasons" are emergent from temperature and moisture.
- The player manages a 20-year campaign where risk gradually increases due to climate change.
- Towns are terrain-aware settlements that start from seeded street skeletons, form compact blocks when terrain allows, and keep growing over the campaign, increasing building exposure and fire risk over time.
- Balance the competing demands of managing a budget, the firefighters under your command, and the community's preparedness.
- The game should feel readable and decisive: clear cause and effect, no hidden "gotchas."

## Design Pillars

- Tactical clarity: players can read why a fire did or did not spread.
- Strategic tension: prevention and response both matter.
- Forecast-driven play: climate outlook guides risk-taking and investment.
- Long arc progression: meaningful growth across a 20-year career.

## Pacing Target

- 20 years should feel like a single run (target: ~30 minutes real time).
- The calendar is continuous; climate creates "virtual seasons."

## Core Player Loop

1) Observe conditions (forecast, wind, risk).
2) Deploy resources and plan containment.
3) React to fires in real time.
4) End-of-year review and budget adjustments.
5) Invest in training, recruitment, and preventative measures.

## Campaign Timeline

- 20 years total.
- No hard season gates in the final design; climate conditions define the current "seasonal mode."
- Year progression should scale difficulty through climate trends, ignition frequency, and unlock cadence.

## Climate and Weather

- Daily temperature and moisture drive ignition and spread.
- Weather forecast provides a rolling 90-day outlook of fire risk.
- A year is 360 days with four distinct seasons: (Winter = cold + moist, Spring = warm + moist, Summer = warm + dry, Autumn is Cool + dry)
- Climate change is represented by a warming trend and drying bias.

## Vegetation and Forest Identity

- Vegetated tiles carry deterministic vegetation state that includes age, canopy cover, and stem density, so forests can look denser without changing the underlying simulation grid.
- Forest stands are assigned one dominant tree identity from pine, oak, maple, birch, or elm. Large forest areas can also contain 1-2 clustered secondary species so they read as stands instead of noisy per-tile mixes.
- Broad environmental bias already shapes composition: drier or higher terrain leans pine, wetter or lower terrain leans elm, and other hardwoods fill the middle ground.
- Tree identity currently drives mapgen readability and rendering variety first. It is not yet a separate fire-fuel model.

## Design Intent

- Cooler/wetter periods allow backburns and controlled fuel management (firebreaks).
- Cooler periods also support lobbying, training, and procurement.
- Hot/dry periods make spread more aggressive and raise multi-front risk.
- During hot periods, most attention is on active response and containment.

## Fire Behavior (Gameplay Perspective)

- Fires spread based on local heat, fuel, moisture, wind, elevation, and neighboring fires.
- Tile type does not add hidden ignition/spread modifiers; differences between forest, house, grass, roads, and other terrain should come from explicit fuel profiles, current fuel load, moisture, heat, wind, elevation, suppression, and non-ignitable fuel values.
- In the campaign, vegetation age controls current available fuel up to the tile type's `baseFuel` cap; SIM Lab treats vegetated tiles as fully fueled from the active fuel profile for direct tuning comparisons.
- Elevation biases heat transfer: uphill cells ignite more easily than downhill cells, while flat terrain remains neutral.
- Terrain can locally shape wind around burning cells with small clamped strength and steering changes, including obstruction, downslope acceleration, and simple corridor funneling; this is not a persistent wind simulation.
- Spread should be reliable in high-risk conditions; low-risk periods should still allow controlled burns.
- The player should feel the difference between a mild year and a severe year.

## Resource Management

- Budget is allocated yearly based on performance.
- Resources:
  - Firefighters and trucks (limited capacity).
  - Training upgrades (speed, power, range, resilience).
  - Firebreak construction.
  - Special policies or equipment (unlock-driven).

Design intent:
- Early years: constrained resources, slower response.
- Late years: larger capacity but higher threat.

## Units and Tactics

- Trucks carry crews; crews are not independently commanded.
- Formations allow tactical positioning.
- Deployments should be fast, readable, and predictable.
- In 3D, hose streams should read as gravity-affected ballistic arcs; when terrain or structures mask the target, the visual stream should lift its attack angle and impact the first visible obstruction instead of drawing a straight-through cone.

## Progression and Unlocks

- Run-style unlocks provide perks or tools that slightly bend strategy.
- Unlocks should be meaningful but not invalidate core systems.
- Examples:
  - Specialized rigs (faster response, higher tank capacity).
  - Policy perks (reduced firebreak cost, faster training).
  - Tactical modules (temporary wind prediction, heat-sink drops).

## Backburning (Planned)

- Player can set controlled burns preferably in low-risk conditions.
- Backburning is a preventative tool, not a free win.
- Ideally permitted based on climate thresholds, not hard seasons.

## UI/UX Goals

- Clear, minimal HUD for time, risk, and wind.
- Banner / border shows "season" by color and decals (TBC) along with key metrics (budget, year etc)
- Top right of screen - Forecast graph shows rolling 90-day fire risk with current-day marker.
- Bottom right of screen - "Announcements" at key events ie a speech bubble from a News Station, Weather Presenter, Financial Advisor etc
- Bottom middle of screen - Debug overlays exist for tuning and dev validation.
- Dev-facing SIM Lab exists for controlled fire-behavior tuning: selectable scenario templates run on a denser 128x80 grid, with terrain painting, painted firefighter suppression markers, local saved/loaded test scenarios, a cell-state legend/symbol overlay, fuel profile sliders, and wind, temperature, moisture, risk, and incident-speed preset controls with explanatory tooltips. Firefighter markers maintain a hose-reachable defensive wetness field and auto-spray nearby hot or burning cells using default firefighter radius, hose range, and power. SIM Lab speed mirrors the game's incident-time tuning surface on the same fixed 0.25s incident tick, adds `0.5x` and `1x` lab convenience options, and is capped at `1x`. The Plain + Road template uses a one-tile road gap so it matches the in-game road scale while still testing fire jumps across non-flammable cells. Fuel profile slider edits apply immediately, auto-save as local SIM Lab drafts, survive saved-scenario loads, and can be copied as a complete `src/config/fuelProfiles.ts` defaults file when ready to promote into source. The `windFactor` slider is displayed as Windbreak: `0` is open/no blocking, `1` is strong wind obstruction.
- Top left of screen - Available trucks to select with key info
- Bottom left of screen - Details on selected unit + available commands

## 3D Terrain Presentation

- Terrain land color should read primarily from the live sun/shadow rig instead of baking major lighting contrast into the albedo.
- Grass, floodplain, beach, and scorched ground should vary in broad 10-20 tile patches so the land reads as cohesive terrain instead of per-tile checkerboarding.
- Slopes should subtly desaturate toward rocky/bare tones while keeping terrain type identity readable.
- Dev-facing terrain tools should retain a legacy faceted comparison mode for validating shading changes without affecting simulation data.

## New Run Configuration (Proposed)

Purpose: expose tunable run constants before each campaign. Defaults are shown, players can keep last-used settings or save a default profile.

### Tabs and Fields

Command Roster
- Chief selection + modifiers (budget, speed, power, containment, firebreak cost, approval retention).
- Starting roster composition (2 firefighters + 1 truck).
- Unit economy + stats (recruit costs, training cost/cap/gains, unit speed/power/radius, truck capacity/board radius, tether distance, formation spacing, movement cost/slope factors, unit loss fire threshold).
- Firebreak cost per tile.

Terrain
- Seed and map size presets.
- Map generation sliders (forest/meadow/water settings).
- Tile fuel profiles (baseFuel/ignition/burnRate/heatOutput/spreadBoost/heatTransferCap/heatRetention/windFactor per tile type); windFactor is retained as the config key but means windbreak strength, where 0 is open terrain and 1 is strong wind obstruction.
- Vegetation regrowth (water influence, ash recovery, canopy growth, forest recruit).
- Community and road generation (town density, bridge allowance, settlement spacing, road strictness, pre-growth years).

Climate
- Climate params (seasonLen, peakDay, tMid, tAmp, warmingPerYear, noiseAmp, heatwavesPerYear).
- Moisture params (Mmin/Mmax, Tdry0/Tdry1, k0/k1).
- Cooling params (base/alpha/Tref/kMinFactor/kMaxFactor).
- Climate risk mapping (CLIMATE_IGNITION_MIN/MAX, spread base/range, risk weights), forecast window (90).
- Wind model tuning (strength base/dryness/temp/year weights, gust).

Fire
- Ignition chance per day, sim speed/tick cadence/rows per slice, render smoothing.
- Fire season taper/min intensity and seasonal fire pacing.
- Deterministic ranged heat diffusion for short firebreak gaps: 10m gaps can cross in bad conditions, 20m gaps require extreme aligned wind/heat, and 30m gaps require explicit extreme tuning. V1 does not model probabilistic long-range ember spotting.
- Heat diffusion constants, ranged-diffusion thresholds/falloff, windbreak obstruction strength, and heat cap.
- Conflagration boosts.
- Fire bounds padding.
- Elevation spread and local terrain-wind shaping tunables.

Other
- Career/time pacing (career years, days/sec, phase durations, ash regrow delay, growth speed).
- Time controls support persisted preset-button mode and an experimental slider mode; the slider spans 0x-80x in 0.25x steps, shares one value across strategic/incident time, and `Skip to Next Fire` temporarily forces max speed before restoring the prior value.
- High-speed strategic time must still detect the first fire-season incident immediately: when calendar advancement seeds or discovers active fire, the sim enters incident mode and pauses before any large high-speed fire step can burn past the opening response window.
- Economy baselines (base budget, approval min, hectares per tile, initial approval).
- Progression toggles (available upgrades list).
- Debug/perf toggles (simPerf, renderTrees/effects), unlimited money.

### Persistence
- Store “last-used run config” and “saved defaults” separately.
- Provide UI actions: Save as default, Reset to defaults.

### Notes
- Expose gameplay/system constants only; keep render-only constants (colors, zoom ranges, tile sizing) out unless a dedicated Visuals tab is desired.

## Risk Communication

- Forecast visual should map to clear risk tiers (low, moderate, high, extreme).
- Color and UI language must match gameplay impact.
- Add tooltip or legend for risk meaning and expected behavior.

## Failure States + Win Conditions

- Failure states:
  - Base destroyed.
  - Approval collapse.
  - Region loss exceeds thresholds.
- Win condition:
  - Complete 20-year career with score summary.


## Difficulty Progression Goals

- Year 1: Manageable single-front fire risk.
- Year 5: Two-front risk possible.
- Year 10: Multiple simultaneous ignitions.
- Year 15+: High volatility; proactive planning required.

This can be achieved by:
- Climate warming and drying trend.
- Increased ignition intensity or frequency.
- Slightly reduced moisture damping over time.

## Economy and Scoring

- Performance review each year from Financial Advisor:
  - Land burned, property loss, life loss, containment success.
- Approval impacts next-year budget.
- Career score accumulates across years.

## Systems Inventory (Current)

- Fire simulation (heat diffusion, ignition scheduling).
- Units (truck + firefighter logic).
- Climate model (temperature + moisture).
- Map generation (terrain, vegetation age/density, forest stand composition).
- Settlements (terrain-aware town seeding, constrained-ribbon vs compact street archetypes, frontage-based annual growth, block-forming road expansion).
- UI system (phase UI, controls, overlays).

## Open Questions

- How should backburning interact with reputation and budget?
- Should there be mid-year policy decisions (e.g., burn bans)?
- How to reward prevention versus reactive suppression?
- How should unlocks be earned: milestones, random events, or shop-like choices?
- Should run events be opt-in choices (risk/reward) or surprise drops?
- How strong can an unlock be before it undermines the climate-driven challenge?
- Do unlocks persist across runs, or reset each 20-year campaign?
- Should "loot box" events be framed as grants, equipment drops, or political favors?
- Should the player choose between 2-3 rewards, or receive a single random drop?

## Decision Log (fill in)

- Finalized loop:
- Difficulty scaling:
- Backburning rules:
- Economy tuning:
