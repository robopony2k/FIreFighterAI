# Firefighter AI - Game Design Reference

Purpose: A concise, editable reference for the overall game loop, systems, and intended player experience. This document is meant to evolve with the design.
Story: You are the new "Fire Warden" in charge of a region. Your mission is to protect and serve the people throughout your career. Will you be the greatest fire warden of all time and a true hero, or will your leadership be so inept that you are fired for incompetence?

## High-Level Vision

- A strategic fire-response simulation with long-term planning and tactical firefighting.
- Climate drives the world instead of fixed seasons; "seasons" are emergent from temperature and moisture.
- The player manages a 20-year campaign where risk gradually increases due to climate change.
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

## Design Intent

- Cooler/wetter periods allow backburns and controlled fuel management (firebreaks).
- Cooler periods also support lobbying, training, and procurement.
- Hot/dry periods make spread more aggressive and raise multi-front risk.
- During hot periods, most attention is on active response and containment.

## Fire Behavior (Gameplay Perspective)

- Fires spread based on local heat, fuel, moisture, wind, and neighboring fires.
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
- Top left of screen - Available trucks to select with key info
- Bottom left of screen - Details on selected unit + available commands

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
- Tile fuel profiles (baseFuel/ignition/burnRate/heatOutput/spreadBoost/heatTransferCap/heatRetention/windFactor per tile type).
- Vegetation regrowth (water influence, ash recovery, canopy growth, forest recruit).
- Community and road generation (village/house counts, value/resident ranges, road bias).

Climate
- Climate params (seasonLen, peakDay, tMid, tAmp, warmingPerYear, noiseAmp, heatwavesPerYear).
- Moisture params (Mmin/Mmax, Tdry0/Tdry1, k0/k1).
- Cooling params (base/alpha/Tref/kMinFactor/kMaxFactor).
- Climate risk mapping (CLIMATE_IGNITION_MIN/MAX, spread base/range, risk weights), forecast window (90).
- Wind model tuning (strength base/dryness/temp/year weights, gust).

Fire
- Ignition chance per day, sim speed/tick cadence/rows per slice, render smoothing.
- Fire season taper/min intensity and seasonal fire pacing.
- Fire jump thresholds/chance/boosts.
- Heat diffusion constants and heat cap.
- Conflagration boosts.
- Fire bounds padding.

Other
- Career/time pacing (career years, days/sec, phase durations, ash regrow delay, growth speed).
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
- Map generation (terrain, vegetation).
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
