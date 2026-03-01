# Road Atlas V2 Draw List

The renderer now expects metadata-driven IDs from `assets/textures/road_atlas_v2.json`.

## New Master Tiles (draw once, code rotates)
1. `base_isolated`
2. `base_endcap_cardinal`
3. `base_endcap_diagonal`
4. `mix_cardinal_diag_adjacent`
5. `mix_straight_diag_single_ns`
6. `mix_straight_diag_single_ew`
7. `mix_straight_diag_pair_ns`
8. `mix_straight_diag_pair_ew`
9. `mix_corner_diag_outer`
10. `mix_tee_diag`
11. `mix_hub_dense`
12. `bridge_abutment_cardinal`
13. `bridge_abutment_diagonal`

## ROAD_TILES_2 Grid Mapping (5x3, row-major)
1. `(0,0)` `base_isolated`
2. `(1,0)` `base_endcap_cardinal`
3. `(2,0)` `base_endcap_diagonal`
4. `(3,0)` `mix_cardinal_diag_adjacent`
5. `(4,0)` `mix_straight_diag_single_ns`
6. `(0,1)` `mix_straight_diag_single_ew`
7. `(1,1)` `mix_straight_diag_pair_ns`
8. `(2,1)` `mix_straight_diag_pair_ew`
9. `(3,1)` `mix_corner_diag_outer`
10. `(4,1)` `mix_tee_diag`
11. `(0,2)` `mix_hub_dense`
12. `(1,2)` `bridge_abutment_cardinal`
13. `(2,2)` `bridge_abutment_diagonal`

## Additional Pieces Added
- `(3,2)` `base_cross` (4-way intersection)
- `(4,2)` `base_tee` (source orientation: missing west, rotates in code)
- `(0,3)` `base_corner_ne`
- `(1,3)` `diag_infill_ne`
- `(2,3)` `mix_diag_to_straight_w_ne`
- `(3,3)` `mix_diag_to_straight_w_se`

## Base Reuse Set
- `base_straight`
- `base_corner`
- `base_tee`
- `base_cross`
- `diag_pair_nesw`
- `diag_pair_nwse`

## Notes
- Current JSON maps several new IDs to legacy atlas cells as temporary placeholders.
- Replace placeholder mappings with final v2 art cells as tiles are drawn.
