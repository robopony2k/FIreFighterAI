# Fire Simulation Review: Fuel, Ignition, Moisture, Climate Risk, and Suppression

## Scope reviewed
- `src/core/climate.ts`
- `src/sim/index.ts`
- `src/sim/climateRuntime.ts`
- `src/core/tiles.ts`
- `src/sim/fire.ts`
- `src/sim/fire/ignite.ts`
- `src/sim/units.ts`
- `src/core/config.ts`

## 1) Climate risk pipeline and where it affects fire behavior

### How climate risk is constructed
- Climate risk is derived from two normalized terms:
  - ignition term (`climateIgnitionMultiplier`),
  - spread term (`climateSpreadMultiplier`).
- Runtime risk combines them as `0.55 * ignitionNorm + 0.45 * spreadNorm`.

### How climate state is updated
- Each simulated career day:
  - ambient temperature is sampled,
  - climate moisture is updated with `moistureStep`,
  - ignition multiplier is raised as moisture drops,
  - spread multiplier is raised as moisture drops.

### Fire-phase gates controlled by risk
- New random ignitions are only allowed when `climateRisk >= FIRE_WEATHER_RISK_MIN` (0.4).
- A burnout/auto-cooling factor is applied when `climateRisk < FIRE_WEATHER_BURNOUT_RISK` (0.25).

## 2) Fuel + moisture + ignition at tile level

### Initial per-tile fuel model
`applyFuel` makes moisture affect fire susceptibility before fire even starts:
- Higher moisture lowers initial fuel mass (`fuel *= (1 - moisture * 0.6)`).
- Higher moisture raises ignition point (`ignition + moisture * 0.35`).
- Higher moisture lowers burn rate (`burnRate * (0.7 + (1 - moisture) * 0.8)`).

This is a strong and coherent coupling: wet tiles are harder to ignite and burn slower.

### In-run moisture use
During `stepFire`, moisture does **not** change dynamically, but it still impacts spread through:
- `moistureFactor = max(0, 1 - moisture * diffusionMoisture)`.

So moisture is currently static per tile during a season but still moderates heat propagation each tick.

## 3) Ignition behavior (random + spread-induced)

### Random ignition
Random starts depend on:
- `ignitionChancePerDay * dayDelta * intensity`, where `intensity = climateRisk * climateIgnitionMultiplier`.

Result: hot/dry climate can increase starts nonlinearly (risk and ignition multiplier both increase as climate dries).

### Spread-induced ignition
For non-burning tiles, ignition happens when heat exceeds climate-adjusted threshold:
- threshold uses `ignitionPoint / ignitionBoost`,
- `ignitionBoost` is `climateIgnitionMultiplier`.

In practice, dry climate lowers effective threshold and increases hazard; tiles can be scheduled to ignite (stochastic delay) or ignite immediately at lower quality levels.

## 4) Self-extinguish / burnout dynamics

There are multiple extinguishing paths:

1. **Fuel depletion burnout**
- Burning consumes fuel; when fuel is exhausted, tile converts to ash and fire ends.

2. **Low-risk climate burnout assist**
- When climate risk is below burnout threshold, `burnoutFactor` cools heat and reduces fire intensity each step.
- This creates a seasonal “easy mop-up” regime.

3. **Passive cooling when not burning**
- Non-burning residual heat decays via either `coolCellTemp` or retention-based damping.
- Scheduled ignition is cancelled if heat drops below ignition point.

Overall, self-extinguish is mostly physical (fuel use + heat cooling) with an additional climate-based suppression term in low-risk weather.

## 5) How suppression interacts with climate and ignition

### Direct suppression effects
`applyExtinguish` reduces both heat and fire in impact radius and can:
- clear scheduled ignitions if heat drops below ignition point,
- force low residual heat after knockdown (`<= ignitionPoint * 0.25`),
- increment containment metrics when a burning tile is knocked out while fuel remains.

### Indirect interaction with climate risk
Suppression does **not** directly read climate risk, but climate still affects suppression outcomes indirectly:
- In high-risk weather, spread and ignition pressure are higher, so suppression must offset more incoming heat/ignition scheduling.
- In low-risk weather, burnoutFactor helps suppression by accelerating cooling and flame decay.

### Important asymmetry
Suppression currently does not modify moisture/humidity state. It is a direct heat/fire knockdown system, not a persistent wetting system.
This means the same tile can re-enter risk once reheated by neighbors if fuel remains.

## 6) Strengths observed

- Clear climate->risk->fire gating loop with deterministic structure.
- Coherent tile susceptibility model (moisture influences fuel, ignition point, burn rate).
- Good separation between random ignitions and neighbor-driven ignition.
- Suppression meaningfully interrupts both active flames and pending ignitions.

## 7) Model limitations / potential tuning issues

1. **Potential double-weighting of dryness on random ignitions**
- `intensity = climateRisk * climateIgnitionMultiplier` may over-amplify starts in very dry periods.

2. **No dynamic fuel-moisture recovery from suppression**
- Water attack reduces heat/fire only; no temporary increase to local moisture or ignition point.

3. **Static per-tile moisture during season**
- Tile moisture does not diffuse/recover with weather or suppression, so local wet/dry history is absent.

4. **Risk not directly modulating suppression efficiency**
- Hot/windy conditions do not degrade water effectiveness directly (only through higher incoming fire pressure).

## 8) Suggested next improvements (ordered)

1. Add a **temporary suppression wetness field** (short half-life) that:
- raises local ignition threshold,
- reduces local heat transfer,
- decays over time.

2. Decompose random ignition intensity into explicit terms and cap composition, e.g.:
- `intensity = lerp(1, climateIgnitionMultiplier, a) * lerp(1, climateRisk, b)` with clamps.

3. Introduce optional **weather-sensitivity on suppression power**:
- reduce effective power slightly at extreme heat/wind to improve realism and challenge curve.

4. Optionally add a lightweight **dynamic moisture update for active fire regions only** to preserve performance.

## Bottom line
The current system is internally consistent and already ties climate risk to ignition opportunity, ignition thresholds, and low-risk burnout support. The largest realism gap is the lack of persistent “wetting” effects from suppression and static tile moisture over the season.
