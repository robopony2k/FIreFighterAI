# Deprecations

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
