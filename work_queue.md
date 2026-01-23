TSK-0122: Forest density representation model



Type: feature

Why: 10×10 m cells render sparse with 1 tree instance per cell; introduce a density representation that can render multiple trees per cell.

Done when:



&nbsp;Each cell has canopyCover (0–1) and stemDensity (0–N) or equivalent



&nbsp;Values are deterministic per seed and tile type



&nbsp;Non-forest tiles default to low/zero values

Touchpoints: data\_model.ts, terrain\_system.ts

Constraints: deterministic; no impact on fire sim unless explicitly wired later

Notes: This is render-driving metadata only.

Status: queued



TSK-0122A: Multi-instance tree scattering per cell



Type: feature

Why: Visually densify forests without changing the simulation grid resolution.

Done when:



&nbsp;Forest cells render multiple tree instances based on stemDensity



&nbsp;Instances are jittered within the 10×10 m cell (seeded)



&nbsp;Tree rotation/scale variance is deterministic (no shimmer)



&nbsp;Performance is acceptable (instancing / batching)

Touchpoints: renderer, terrain rendering code, terrain\_system.ts

Constraints: use GPU instancing; deterministic placement; LOD-friendly

Notes: This is the “big win” for dense-looking forests.

Status: queued



TSK-0122B: Canopy/understorey fill at distance



Type: polish

Why: Even with instanced trees, mid/far distances can look sparse; add cheap canopy fill.

Done when:



&nbsp;Mid/far forest areas read as continuous canopy (impostor cards / canopy blobs / ground tint)



&nbsp;Transition is stable with camera movement (no popping or obvious tiling)

Touchpoints: renderer, materials/shaders

Constraints: cheap; deterministic; avoid alpha overdraw explosion

Notes: This can be as simple as a forest-floor “canopy shadow” layer + sparse extra billboards.

Status: queued



TSK-0123: Define forest tree type roles



Type: feature

Why: Establish a shared, stable vocabulary for forest composition before touching generation logic.



Done when:



 TreeType enum exists with: pine, oak, maple, birch, elm, scrub



 Each tree type has a short inline comment describing its role



Touchpoints: data\_model.ts

Constraints: no behavioural logic; naming only

Notes: Semantic step only; no visual or simulation changes expected.

Status: queued



TSK-0124: Assign dominant tree type per forest area



Type: feature

Why: Forests need a single dominant identity to avoid visual noise and random mixing.



Done when:



 Each forest area is assigned exactly one dominant TreeType



 Dominant type is deterministic per world seed



 Adjacent forest areas can have different dominant types



Touchpoints: terrain\_system.ts

Constraints: no clustering yet; one value per forest area

Notes: Classification only; rendering may still be uniform.

Status: queued



TSK-0125: Render forests with dominant tree visuals only



Type: polish

Why: Validate that dominant forest identity is visually readable before adding complexity.



Done when:



&nbsp;Forests look visibly dense at gameplay zoom (canopy coverage reads as forest)



 Forests visually differ based on dominant tree type



 Differences are visible at normal gameplay zoom



 No secondary species appear yet



Touchpoints: terrain\_system.ts, rendering / tree assets

Constraints: deterministic visuals; minimal art variance

Notes: Intentional “boring but readable” checkpoint.

Status: queued



TSK-0126: Introduce clustered secondary tree patches



Type: feature

Why: Real forests are patchy; clustering secondary species avoids checkerboard noise.



Done when:



 Secondary tree types appear in multi-tile clusters



 Clusters are deterministic and seeded



 No single-tile random species swaps occur



Touchpoints: terrain\_system.ts

Constraints: simple blob or noise-based clustering only

Notes: Limit to 1–2 secondary species per forest area.

Status: queued



TSK-0127: Bias tree types by broad environmental zones



Type: feature

Why: Broad environmental bias improves believability without hidden simulation.



Done when:



 Pine bias toward drier / higher areas is visible



 Elm bias toward wetter / lower areas is visible



 Biases influence probabilities, not hard rules



Touchpoints: terrain\_system.ts

Constraints: use existing elevation / moisture inputs only

Notes: Should subtly affect composition, not redraw biomes.

Status: queued



TSK-0128: Regrowth composition after fire



Type: feature

Why: Burned forests should visually and structurally change over time.



Done when:



 Recently burned forest areas bias toward birch and scrub



 Regrowth composition is visible before full forest recovery



 Behaviour is deterministic across runs



Touchpoints: growth\_system.ts

Constraints: no new lifecycle states beyond composition bias

Notes: First task that depends on post-fire history.

Status: queued



TSK-0129: Map tree types to existing fire fuel parameters



Type: refactor

Why: Visual forest differences should align with intuitive fire behaviour.



Done when:



 Each TreeType maps to existing fuel parameters



 No new fire mechanics are introduced



 Fire behaviour differences are noticeable but not extreme



Touchpoints: fire\_system.ts, data\_model.ts

Constraints: reuse existing parameters only

Notes: Tuning step, not a new fire model.

Status: queued



TSK-0130: Forest composition validation pass



Type: polish

Why: Ensure the system reads clearly and avoids accidental complexity.



Done when:



 Forests read as stands, not random mixes



 Composition differences are visible without UI



 No performance regression observed



Touchpoints: terrain\_system.ts, growth\_system.ts, fire\_system.ts

Constraints: no new features added

Notes: Explicit “stop here if good enough” checkpoint.

Status: queued

