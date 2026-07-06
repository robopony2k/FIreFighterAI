# Firefighter AI - Game Design Reference

Purpose: A concise, editable reference for the overall game loop, systems, and intended player experience. This document is meant to evolve with the design.
Story: You are the new "Fire Warden" in charge of a region. Your mission is to protect and serve the people throughout your career. Will you be the greatest fire warden of all time and a true hero, or will your leadership be so inept that you are fired for incompetence?

## High-Level Vision

- A strategic fire-response simulation with long-term planning and tactical firefighting.
- Climate drives the world instead of fixed seasons; "seasons" are emergent from temperature and moisture.
- The player manages a 20-year campaign where risk gradually increases due to climate change.
- Towns are terrain-aware settlements that start from seeded street skeletons, form compact blocks when terrain allows, and keep growing over the campaign, increasing building exposure and fire risk over time. Map generation precomputes each town's ideal 20-year expansion queue, records replayable prerequisite road paths, and bakes the required future house-pad terrain into the day-1 landform, while runtime approval and recovery pressure decide how quickly queued expansion lots and their prerequisite roads become active. Runtime construction does not reshape terrain; buildings adapt to the static landform through structure grounding and foundations.
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
- Weather forecast provides a rolling 90-day outlook of fire risk and overlays deterministic seeded autumn rain periods as blue bands so players can see the upcoming weather-clear window.
- A year is 360 days with four distinct seasons: (Winter = cold + moist, Spring = warm + moist, Summer = warm + dry, Autumn is Cool + dry)
- Climate change is represented by a warming trend and drying bias.
- Each year has one deterministic, seed-jittered mid-autumn rain event. It is brief, reads as a 3D ShaderToy-inspired weather front: low-step volumetric-feeling storm clouds in the seasonal sky plus screen-space rain aligned to wind direction relative to the camera, with wet dimming, mist, and sheen. Sky color, cloud cover, cloud tone, and open-ocean color share one smooth seasonal weather mood: summer is clearer and bluer, winter is greyer and heavier, autumn is muted without being stormy by default, and rain/storm states visibly darken both sky and ocean. Cloud and rain animation are driven by simulation career time, so they advance with the calendar and freeze when the game is paused. The event clears any remaining active fires as weather without awarding firefighter suppression credit or restoring burned fuel.

## Vegetation and Forest Identity

- Vegetated tiles carry deterministic vegetation state that includes age, canopy cover, and stem density, so forests can look denser without changing the underlying simulation grid.
- Campaign vegetation maturity is tuned for the 20-year run rather than real-world botany: grass/floodplain mature in about one year, scrub in about two years, and forest reaches full gameplay fuel/canopy maturity in about five years.
- Strategic vegetation growth is processed in deterministic seasonal block batches, not literal daily full-map ecology. Low block budgets must still catch every region up over elapsed career time, while visual terrain refreshes are batched until changes are meaningful.
- Forest expansion should be visible over a few quiet growth seasons; open vegetated tiles and suitable non-rocky bare lowlands can recruit into young forest from runtime tree suitability and seed pressure instead of being locked to initial biome classification.
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
- Terrain shapes wind through a deterministic source-edge propagation approximation derived from the current global wind direction. It allows clamped ridge deflection, valley channeling, lee shelter, and mild wake turbulence without becoming a persistent fluid simulation.
- Spread should be reliable in high-risk conditions; low-risk periods should still allow controlled burns.
- Campaign random ignitions require viable incident weather, so low or moderate forecast risk can still be shown without creating false-alarm fires that immediately fizzle. Manual, debug, controlled-burn, and SIM Lab ignitions can still test low-risk fire behavior.
- The Fire Ignition Events runtime toggle gates new campaign fire starts and heat/spread-scheduled ignition events, allowing no-fire runs that evaluate forest and town growth without burning the region.
- The player should feel the difference between a mild year and a severe year.

## Resource Management

- Budget is allocated yearly based on performance.
- Every generated town starts with a settlement-owned water tower rendered as a procedural 3D structure with legs, struts, ladder, side pipe, cylindrical tank, and conical roof. Tower visuals use the 10 m tile scale: a small town water tower is roughly one tile wide and about 18-25 m tall. Water towers are finite local reservoirs, not terrain water: stopped trucks inside the tower service radius can refill from stored water, draining the tower, while dry weather restores only a slow trickle and active seasonal rain restores water much faster. V1 towers do not provide passive suppression, upgrades, destruction, construction/procurement gating, or manual targeting.
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
- Firefighters operate hose streams; trucks carry crew and water but do not directly spray. A truck can move only with at least one crew member to drive, operates one hose with at least two crew, and can operate a second hose only with at least four crew plus Dual Line Operations. Crew must board before movement orders execute, then disembark into deterministic roles before suppression begins: the driver stays hidden in the truck, nozzle operators work the active hose lines, and extra crew become pump-side or hose-assistant support rather than creating extra streams. Third, fourth, and fifth crew members reduce boarding/disembark downtime, with fourth and fifth crew adding small hose-range/handling boosts.
- Squad commands split player-owned truck placement from deployed firefighter tasks. Move, Deploy, Relocate, and Recall decide whether trucks board crew, drive to the player formation, disembark, or clear tasks; Suppress, Contain, Backburn, and Hold Fire only control what deployed firefighters attempt from the truck's current placement. Fire tasks and stance changes must not reposition trucks, except Defensive may retreat when the truck tile is directly unsafe. Out-of-range or not-yet-deployed fire tasks report readiness alerts instead of solving a new truck position.
- Formations allow tactical positioning.
- Deployments should be fast, readable, and predictable.
- Unit and vehicle movement should consume the full movement budget implied by current effective game speed, terrain movement costs, and character/training/progression speed upgrades. Active-fire runtime caps may lower fire work and calendar advancement, but response vehicles should still move at the effective game-speed movement budget. Rendering should interpolate from the previous committed position to the current committed position every frame, so high-speed or upgraded movement reads as continuous travel instead of one-tile step pauses.
- In 3D, hose streams should read as gravity-affected ballistic arcs; when terrain or structures mask the target, the visual stream should lift its attack angle and impact the first visible obstruction instead of drawing a straight-through cone. Supply hoses should appear only for active nozzle operators and read as lightly slack, unfurled hoses between the truck and nozzle rather than taut lines to every deployed firefighter.

## Tactical Evacuation

- Town evacuation is a tactical commitment, not an abstract warning ladder: the player selects a town, picks a road-reachable evacuation destination, previews the exact initial route, then issues the order.
- The route preview is not advice. The player judges the route from visible fire, roads, terrain, town layout, traffic, distance, and fire spread direction.
- The game validates only basic feasibility and must not show route safety scores, recommended points, best routes, alternatives, ETA, survival odds, heat ratings, congestion forecasts, or warning copy that tells the player a route is bad.
- Civilian evacuation uses representative vehicles rendered as varied civilian cars. Vehicles follow the locked route, occupy road slots, queue behind blockers, accumulate heat exposure, burn under sustained or extreme exposure, kill occupants when destroyed, and leave road obstacles that reduce or block capacity.
- Evacuation vehicles use the same smooth route-motion contract as response vehicles: simulation owns route progress, occupancy, heat exposure, and blockage, while rendering interpolates continuous previous/current positions between simulation commits.
- Completed evacuation vehicles remain staged at the selected destination until the player orders evacuees to return home. Non-town destinations visibly park vehicles off-road near the evacuation point; destination towns host evacuees off-map instead, creating over-capacity approval pressure for both the origin and host towns while evacuees stay there. Return-home uses the same locked route in reverse and keeps the same queueing, blockage, and heat exposure rules.
- Evacuation outcomes update town population counts and should feed existing approval/scoring hooks where available.

## Progression and Unlocks

- Tech-tree progression is campaign-scoped and resets for every 20-year run.
- Assisted extinguishes award command experience. Each command level opens a deterministic draft of up to three currently reachable tech nodes; the player selects one node or one additional rank. The existing level curve continues beyond level 10 and drafts stop only when every authored node is at maximum rank.
- Every node has stable graph metadata: branch, tier/order, prerequisites with minimum ranks, maximum rank, rarity, draft weight, effects, and granted capabilities. The eventual visual tree is a roadmap for the full graph and current draft state; it does not bypass draft acquisition.
- The initial graph has four branches:
  - Awareness gates Field Mapping, Weather Instruments, Topographic Survey, Moisture Analysis, Thermal Imaging, Dispatch Tracking, and Aerial Reconnaissance.
  - Operations contains Rapid Response, Fireline Training, Extended Lines, and Air Support.
  - Logistics contains Quick Connects, Tender Upfit, and Dual Line Operations.
  - Policy contains Academy Subsidy and Fuel Break Grants.
- Runtime information is genuinely capability-gated: the minimap is hidden until Field Mapping; each analytical map mode is separately unlocked; all player-facing wind data is hidden until Weather Instruments; unit markers require Dispatch Tracking; and Satellite requires Aerial Reconnaissance. These gates affect information access only and never disable the underlying simulation.
- Fire knowledge is separate from authoritative fire simulation. Fires can ignite and spread before the player knows about them; watch towers, nearby towns/units/assets, and large visible smoke/fire thresholds reveal suspected or confirmed reports without changing fuel, heat, wind, moisture, suppression, scoring, or spread. Watch towers are maintenance-phase town facilities with three upgrade levels that improve detection radius, alert delay, and location accuracy; their procedural 3D model gets visibly taller as the tower level increases, from a basic 12-18 m tower toward a 20-28 m upgraded lookout on roughly one tile of footprint. Unknown fires do not appear as normal fire alerts or non-thermal minimap markers, but in-frame 3D fire visuals still render from the authoritative simulation. Thermal imaging remains the capability-gated analytical exception that can expose raw heat.
- Unlocks should be meaningful but not invalidate core systems. Ranked numeric perks retain diminishing returns and authored caps.

## Backburning (Planned)

- Player can set controlled burns preferably in low-risk conditions.
- Backburning is a preventative tool, not a free win.
- Ideally permitted based on climate thresholds, not hard seasons.

## UI/UX Goals

- Clear, minimal HUD for time, risk, available budget, and unlocked field intelligence. Runtime minimaps use mutually exclusive terrain, satellite, topographic, moisture, and heat base modes, with the widget and each mode exposed only after its corresponding tech node is owned. Terrain, topographic, moisture, and heat are analytical raster modes; Satellite is a cached top-down 3D world capture refreshed on first selection, visual rebuilds, and sparse multi-day cadence rather than every fire or unit tick. Unlocked wind and unit indicators remain tactical overlays for the analytical modes, while Satellite stays an aesthetic world-recognition view without HUD, label, wind, or unit overlay markers. Suspected fire reports use approximate, visually distinct markers until confidence improves; confirmed reports graduate to normal fire alert behavior. Minimap wind overlays show the global prevailing/current wind plus sparse propagated local wind barbs so players can read ridge deflection, valley channeling, and sheltered downwind wakes; barb length reflects local speed, with calm samples drawn as dots.
- Operational interface typography uses self-hosted Barlow as the primary UI font at weights 400-700 so small HUD labels, squad names, buttons, statistics, and dense Fire-phase controls stay readable and technical without becoming futuristic. EMBERWATCH title art and major cinematic headings may keep a separate display treatment, but normal HUD, panels, commands, labels, and values should remain Barlow.
- Banner / border shows "season" by color and decals (TBC) along with key metrics (budget, year etc)
- Top right of screen - Forecast graph shows rolling 90-day fire risk with current-day marker.
- Bottom right of screen - "Announcements" at key events ie a speech bubble from a News Station, Weather Presenter, Financial Advisor etc
- Bottom middle of screen - Debug overlays exist for tuning and dev validation.
- Dev-facing SIM Lab exists for controlled fire-behavior tuning: selectable scenario templates run on a denser 128x80 grid, with terrain painting, painted firefighter suppression markers, local saved/loaded test scenarios, a cell-state legend/symbol overlay, fuel profile sliders, and wind, temperature, moisture, risk, and incident-speed preset controls with explanatory tooltips. Firefighter markers maintain a hose-reachable defensive wetness field and auto-spray nearby hot or burning cells using default firefighter radius, hose range, and power. SIM Lab speed mirrors the game's incident-time tuning surface on the same fixed 0.25s incident tick, adds `0.5x` and `1x` lab convenience options, and is capped at `1x`; both SIM Lab and in-game incidents intentionally pace fire-kernel spread below incident clock time so active fires remain tactically readable at the slow presets. The Plain + Road template uses a one-tile road gap so it matches the in-game road scale while still testing fire jumps across non-flammable cells. Fuel profile slider edits apply immediately, auto-save as local SIM Lab drafts, survive saved-scenario loads, and can be copied as a complete `src/config/fuelProfiles.ts` defaults file when ready to promote into source. The `windFactor` slider is displayed as Windbreak: `0` is open/no blocking, `1` is strong wind obstruction.
- Dev-facing FX Lab includes scripted fire, hose, shoreline, river/waterfall, house lifecycle, construction dust, and shared sky/cloud/rain weather scenes so rendering-only effects can be verified without waiting on campaign timing and weather tuning stays mirrored with the 3D game view. Its weather playback can lock to the rain event, cycle through the year, or hold fixed winter/spring/summer/autumn cloud states for comparison.
- Bottom command tray is the primary unit control surface: five fixed squad slots map to keys 1-5, HQ-created squads appear before dispatch, unstaffed/empty slots stay visually faint, and fielded slots select existing command-unit squads. The active squad detail panel mirrors the squad truck layout in compact form, uses status labels such as `At HQ`, `En route`, `Boarding`, `Deploying`, `On fireline`, `Withdrawing`, and `Holding`, and shows trucks, aggregate water/crew/status, placement mode, fire task, stance, and dispatch formation controls. Right-click is the terrain order gesture: a short right-click issues the active placement and fire task at the clicked tile, while holding or dragging right-click projects the chosen Line, Wedge, or Arc formation onto terrain so mouse direction controls facing and mouse distance controls width before release commits the order. While projection is active, camera panning/rotation pauses so the player can tune the formation without the terrain moving underneath the cursor. Pending HQ squad dispatch uses the same quick placement and projected formation placement rules. Normal 3D unit labeling is squad-level: one distinct squad marker with a leader line represents each occupied command-unit squad, while individual trucks keep only minimal selection feedback unless a focused detail view needs them.
- Base Ops is a headquarters facility on its owning town, not a separate selectable settlement identity. Every town uses the same Town panel structure for settlement facts, alerts, approval, evacuation, and town-level actions; functional buildings appear in a generic Facilities section. The HQ town banner and Town panel show an `HQ` badge, and selecting the HQ facility opens a sidecar for recruitment, training, persistent squad roster management, and squad dispatch. Non-HQ towns expose town commands such as evacuation and functional facilities such as water towers and watch towers through the same sidecar pattern.
- HQ squads are five persistent named truck groups, managed in the HQ sidecar through compact drag/drop squad rows rather than wide roster rows. The Squads tab is split into `Squad Trucks` for assigning trucks to squads and `Truck Crew` for assigning recruited firefighters to the currently selected squad's trucks. Each squad row has five horizontal vehicle slots; filled slots show compact crew dots and available/fielded water where authoritative truck water exists, while open slots stay faint and visibly empty. Assignment views use firetruck and firefighter icons for compact scanning; firefighter names stay out of the main compact grid and are exposed only through selection/tooltip detail. Firefighters inherit squad participation through their assigned truck rather than becoming direct squad members. Truck squad membership can only change while the truck is available at HQ; crew assignment remains a maintenance task and respects truck capacity. Recruited trucks default into the most empty squad with an open vehicle slot, and recruited firefighters default into the most empty available truck with crew capacity. Partial squads may be dispatched to real map locations. Dispatch is one squad at a time through the HQ facility sidecar and bottom command tray, with initial `Line`, `Wedge`, and `Arc` placement behavior. The HQ recruit tab shows available budget, recruit purchase prices, and current truck/crew counts so recruitment feedback is visible immediately after purchase. Training remains selected-roster-unit based until the broader squad-level versus unit-level training model is resolved. Squads remain where ordered until moved again; autumn rain and winter rollover issue return-to-HQ orders so trucks visibly drive home before becoming editable again.
- Right-side runtime dock stays focused on widgets such as fire risk, minimap, time, and contextual information rather than duplicating unit command ownership.
- 3D run exit controls should be compact and contextual: use a single Main Menu action inside the command/progression counter instead of a separate top header that reduces world viewport space.
- The 3D run command/progression ledger lets players jump between connected active firefronts from the Active Fires row without changing unit selection or command mode; these focus moves should preserve map awareness with eased camera travel, using only modest lift for distant fronts and staying quick for nearby fronts.
- The 3D run camera should stay above the terrain and keep pan targets inside the playable map so normal orbit and pan controls never expose the underside of the world.
- Game-over and manual End Run flows stay on the 3D runtime and show a dedicated end-run summary placeholder with final score, reason, seed, year, and New Run/Main Menu actions.
- New-run map preparation should use a full black loading screen with a centered tip/placeholder graphic pairing that cycles every 10 seconds, a bottom-centered progress bar spanning two-thirds of the viewport, and one compact debug state line for stage-specific mapgen detail, especially during expensive road-network routing and connectivity repair.

## 3D Terrain Presentation

- Terrain land color should read primarily from the live sun/shadow rig instead of baking major lighting contrast into the albedo.
- Grass, floodplain, beach, and scorched ground should vary in broad 10-20 tile patches so the land reads as cohesive terrain instead of per-tile checkerboarding.
- Burned ground should use renderer-only scorched coverage to hide square ash boundaries: ash tiles fully surrounded by ash render as complete ash, while edge ash tiles and actively burning vegetated cells use deterministic 16th-cell/triangle char and soot coverage based on neighboring burn-front cells. Protected surfaces such as roads, buildings, water, base, and firebreaks remain readable and are not overpainted by the burn-scar treatment.
- Burning vegetated ground should visibly scorch through fire FX and committed terrain-state changes, with live heat/fuel ground tinting deferred when needed so large fire fronts do not freeze vehicles or camera motion.
- Slopes should subtly desaturate toward rocky/bare tones while keeping terrain type identity readable.
- Biome classification should use rendered slope angle, local single-cell slope, and nearby relief to push steep exposed land toward rocky before forest or scrub; waterfall drop is only a nearby hydrology hint, not the primary steepness signal. Tree suitability stays full on 0-20 degree slopes, tapers through 20-35 degrees, becomes sparse at 35-45 degrees, and is mostly blocked above 45 degrees. Shrub suitability stays full on 0-30 degree slopes, tapers through 30-45 degrees, becomes sparse at 45-55 degrees, and is mostly blocked above 55 degrees.
- High, dry, steep mountain terrain should use render-only procedural rock masks plus `assets/textures/rock_texture.png` in the terrain shader so exposed slopes read as fractured, granular rock without changing simulation terrain, fuel, moisture, or hydrology.
- Dev-facing terrain tools should retain a legacy faceted comparison mode for validating shading changes without affecting simulation data.
- Terrain generation uses a shared Mapgen4-inspired grid landmass core for editor previews and `terrain:elevation`, deriving dry shape, coastline intent, off-center uplands, watershed ridges, lowland basins, valleys, and drainage support fields from seeded noise, elevation redistribution, and an organic island field before sea level, ocean flooding, accurate rivers, biomes, settlements, roads, and fuel stages run. Named archetypes explicitly shape large-scale catchments before hydrology: Spine favors a central or offset watershed with side valleys, Twin Bay wraps ridges around bays and inland saddles, and Massif forms radial highland drainage with foothill and high-pocket basins. Default islands should avoid square map-edge coastlines and raised cut-out slab walls: visible coastlines come from radial/noisy elevation shaping with seeded headlands, bays, shelves, and side inlets before sea level is solved, while the rectangular map border is only a narrow ocean safety guarantee. Shoreline and render stages may soften shelves, beaches, river mouths, and local cliffs, but must not manufacture broad terrain walls after flooding.
- Static hydrology treats rivers, inland lakes, lake outlets, and waterfalls as one generated water network. A baked priority-flood basin pass routes seeded rainfall/runoff over the final generated terrain, detects enclosed depressions, fills accepted basins to their lowest spill elevation, and starts visible rivers from each accepted lake's calculated overflow point. Strong hill and mountain basins become lakes when rainfall, runoff, depth, ocean separation, and outlet integration are credible; downstream channels continue from lake outlets toward other lakes or the ocean. Accepted lake, river, and waterfall water tiles remain non-burnable water sources with full moisture and zero fuel. Inland lakes should share the calmer river-water presentation, sit visibly inside their carved basins, and connect to generated inlet/outlet channels or outlet waterfalls instead of reading as separate ocean patches.
- The firebase starts near the center of the main island, but placement scores nearby lowland candidates instead of blindly accepting the exact map center. It should prefer flat, moderate-elevation, roadable ground with nearby vegetated fuel so the base is not stranded on barren high terrain.
- Settlement placement uses rendered slope angle as a first-class terrain fit signal: towns should prefer sites around 12 degrees or lower, tolerate only moderate angle fallback, and reject steep house plots unless mapgen/preplanning can reconcile them into an accessible pad before the run starts.
- Initial map generation guarantees the firebase and all seeded towns share one edge-connected road network. Road strictness remains an internal/debug tuning input, not something players must adjust to avoid isolated towns.
- Intertown roads use bounded multi-destination Dijkstra route search with rendered slope angle, deterministic terrain costs, and failed-attempt reuse to connect each origin to the cheapest valid road, settlement-access, bridgehead, pass, or valley seed currently available. Normal connectors prefer low-angle terrain, switchback along contours on steep climbs when possible, allow only bounded hairpin-context grade discounts for short steep switchback corner steps, skip locally redundant node-to-node recuts, prune redundant short-cycle connector artifacts outside settlement structure zones, use generated non-town junction candidates to avoid repeated full-map pairwise cuts, and reserve bounded mountain-pass fallback for connectivity cases that cannot otherwise be solved. The terrain editor exposes maximum accepted road grade as a settlement-stage tuning control so gradient-related routing failures can be diagnosed without changing route-search code.
- Compound road connectors are applied atomically: failed junction or waypoint attempts must not leave visible dead-end fragments. Mapgen road grading and rendered house-footprint reconciliation keep road surfaces and preplanned building pads accessible; runtime settlement growth must not edit elevation or trigger terrain/water geometry rebuilds.
- 3D town and firebase nameplates should remain readable without drawing through hills or mountains: labels lift along their world anchor until the terrain depth line is clear, lengthening the connector instead of pretending obstructed settlements are in front.
- Each world seed also derives a fictional prevailing wind direction, strength, and variability; that seed climate carries ocean moisture inland so windward slopes trend wetter, leeward rain shadows trend drier, and the resulting static moisture shapes biome, fuel, and later fire-season wind bias. Terrain vegetation derives continuous tree suitability from moisture, elevation stress, slope stress, river/coastal influence, and seeded biome noise, so forests thin probabilistically and patchily instead of ending at a hard contour. Forest remains the fuel category, while pine, oak, maple, birch, and elm are assigned as clustered visual stand patches for 3D assets and canopy color variation.
- The terrain editor early sequence is Scenario, Landform, Surface, and Water for fast landmass previews. Scenario shows raw noise; Landform focuses on dry elevation height without sea-level or island-coverage calibration; Surface adds secondary ridge texture and surface-pattern detail without forcing a universal central mountain spine; Water is the first fast preview that applies seeded noisy distance shaping, lifts central land, pulls outer map regions below water, then uses the Land mass target to calibrate sea level and render connected ocean. Editor steps do not start preview generation automatically; selecting or editing a stage marks it for generation, and the active stage renders only after the user runs Generate Preview. Rivers is an accurate staged preview that advances the mapgen session through shoreline and river carving before rendering. Biomes is a separate staged preview that runs biome field/spread/classification before settlement and road generation. Dev-only map editor diagnostics can record hydrology candidates/rejections/lake overflow routes and road search attempts/results while keeping normal generation deterministic; diagnostic previews can be cancelled and retain the latest partial preview for debugging slow or failing mapgen.

## New Run Configuration (Proposed)

Purpose: expose tunable run constants before each campaign. Defaults are shown, players can keep last-used settings or save a default profile.

### Tabs and Fields

Command Roster
- Chief selection uses compact portrait icons and a large selected-chief detail panel with paired male/female PNG portrait art.
- The roster includes a male/female portrait toggle; random callsigns use first-name pools matching the selected toggle.
- Chief modifiers are shown for budget, speed, power, containment, firebreak cost, and approval retention.
- Starting roster composition (2 firefighters + 1 truck).
- Unit economy + stats (recruit costs, training cost/cap/gains, unit speed/power/radius, truck capacity/board radius, tether distance, formation spacing, movement cost/slope factors, unit loss fire threshold).
- Firebreak cost per tile.

Terrain
- Seed and map size presets.
- Map generation sliders (forest/meadow/water settings).
- Island archetypes should visibly change the same-seed initial relief, coastline plan, watershed ridges, valley corridors, catchments, and lake-prone basin pockets. The `None` archetype is intentionally neutral, applying no named island bias so developers can judge pure noise and exposed terrain parameters directly. The fast noise/elevation redistribution layer is the primary landform proxy for natural islands, ridges, shelves, bays, uplands, and static-hydrology support; literal plate simulation is not a design goal.
- Default islands should read as varied single-island regions rather than volcano cones: center position should not imply highest elevation, and uplands should be distributed by seeded ridges, basins, shelves, and valleys.
- Terrain editor previews prioritize instant feedback for landform height, surface detail, and water controls using the same fast landmass core as `terrain:elevation`; Rivers, Biomes, and later final-quality stages are not started until their step is selected, then advance the current preview session instead of restarting earlier completed stages. Landform owns height controls such as Relief, Ruggedness, and Max height; Water exposes Land mass as the primary coastline coverage control and sea-level bias as an advanced calibration override.
- Tile fuel profiles (baseFuel/ignition/burnRate/heatOutput/spreadBoost/heatTransferCap/heatRetention/windFactor per tile type); windFactor is retained as the config key but means windbreak strength, where 0 is open terrain and 1 is strong wind obstruction.
- Vegetation regrowth (water influence, ash recovery, canopy growth, runtime tree suitability, block catch-up, forest recruit).
- Community and road generation (town density, compact density-derived starting populations, bridge allowance, settlement spacing, maximum accepted road grade, debug/internal road strictness, guaranteed initial road connectivity, angle-aware intertown routing). Starting towns fill existing road frontage before adding a bounded demand-backed extension, rather than simulating decades of visible road growth before the campaign. The map editor may expose a temporary dev-only skip for expensive road routing so other terrain, hydrology, vegetation, or settlement features can be validated without waiting on intertown road search attempts.

Climate
- Climate params (seasonLen, peakDay, tMid, tAmp, warmingPerYear, noiseAmp, heatwavesPerYear).
- Moisture params (Mmin/Mmax, Tdry0/Tdry1, k0/k1).
- Cooling params (base/alpha/Tref/kMinFactor/kMaxFactor).
- Climate risk mapping (CLIMATE_IGNITION_MIN/MAX, spread base/range, risk weights), forecast window (90).
- Wind model tuning (seeded prevailing wind, seasonal variability, strength base/dryness/temp/year weights, gust).

Fire
- Ignition chance per day, sim speed/tick cadence/rows per slice, render smoothing.
- Fire season taper/min intensity, seasonal fire pacing, and the incident fire-kernel pacing scale used to keep slow active incidents readable.
- Deterministic ranged heat diffusion for short firebreak gaps: 10m gaps can cross in bad conditions, 20m gaps require extreme aligned wind/heat, and 30m gaps require explicit extreme tuning. V1 does not model probabilistic long-range ember spotting.
- Heat diffusion constants, ranged-diffusion thresholds/falloff, windbreak obstruction strength, and heat cap.
- Conflagration boosts.
- Fire bounds padding.
- Elevation spread and local terrain-wind shaping tunables.

Other
- Career/time pacing (career years, days/sec, phase durations, ash regrow delay, growth speed).
- Time controls support persisted preset-button mode and an experimental slider mode; the slider spans 0x-20x in 0.25x steps, shares one value across strategic/incident time, and `Advance to Next Event` temporarily forces 20x before restoring the prior value.
- High-speed strategic time must still detect enabled pause events immediately: when calendar advancement seeds or discovers a pause-enabled fire, the sim enters incident mode and pauses before any large high-speed fire step can burn past the opening response window. Strategic fast time is capped at an effective 20x and may be further limited near fire-eligible weather or active fire work by the fire kernel's idle adaptive window. Fire catch-up work is additionally bounded by a per-frame substep budget and may carry deferred fire days across frames so high-speed fire seasons stay responsive instead of processing every backlog substep in one frame. Fire simulation remains tied to simulation speed, but fire FX should interpolate and smooth between previous/current fire snapshots so the visible front does not snap only on fire-kernel ticks. Vehicle movement follows the effective game-speed movement step even when active-fire work applies a lower fire/runtime step, uses the same previous/current visual interpolation contract, and perf telemetry should distinguish requested, effective, movement, and actually applied speed when lower fire/runtime caps are active. The 3D runtime should only hold accelerated simulation for immediate terrain geometry, debug, or structure sync; vegetation, surface-color, and fire-visual batches can defer without stopping movement. Spring settlement growth should replay precomputed road paths and refresh road/structure visuals without forcing a full base terrain mesh rebuild. Fire, annual report, and rain pause behavior can be toggled independently from event source toggles.
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
- Risk is a climate severity signal, not a direct guarantee that a random incident will start; campaign random starts are additionally gated by ignition, spread, sustain, and cooling viability.
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
- Tactical evacuation (town destination selection, locked road routes, representative civilian vehicles, road slot queueing, heat exposure, vehicle destruction, and population/life-loss hooks).
- Climate model (temperature + moisture).
- Map generation (terrain, vegetation age/density, forest stand composition, and deterministic 0-40 year vegetation pre-growth that advances spread and maturity after settlements and roads are reconciled without changing infrastructure).
- Settlements (angle-aware terrain-fit town seeding, constrained-ribbon vs compact street archetypes, compact day-one housing bootstrap, precomputed deterministic 20-year ideal growth queues with future roads hidden until their houses are built, self-contained cumulative prerequisites from successful house plans only, atomic single-extension road trials that are discarded when no valid lot results, approval-gated queue consumption, compact infill/densification, event-style construction catch-up, block-forming road expansion).
- UI system (phase UI, controls, overlays).

## Open Questions

- How should backburning interact with reputation and budget?
- Should there be mid-year policy decisions (e.g., burn bans)?
- How to reward prevention versus reactive suppression?
- Should run events be opt-in choices (risk/reward) or surprise drops?
- How strong can an unlock be before it undermines the climate-driven challenge?
- Should "loot box" events be framed as grants, equipment drops, or political favors?

## Decision Log (fill in)

- Finalized loop:
- Difficulty scaling:
- Backburning rules:
- Economy tuning:
