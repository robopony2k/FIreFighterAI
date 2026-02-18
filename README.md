# Fireline Command

Top-down firefighting strategy game built with TypeScript + Canvas. Procedural landscapes, spreading fires, deployable units, and a local leaderboard.

## Run locally
1. Start the dev server: `npm run dev`.
2. Open `http://localhost:5173`.

Runtime flags:
- `?render=2d`: enable legacy 2D compatibility renderer (deprecated).
- Default is 3D runtime.

Alternative:
- VS Code: use the "Live Server" extension.
- Python: `python -m http.server` then open `http://localhost:8000`.

## Build (optional)
If you want to edit TypeScript and rebuild the JS bundle:
1. `npm install`
2. `npm run build`

The compiled output is `dist/main.js`.

## How to play
- Click "Firefighter" or "Truck", then click a tile to deploy.
- Click a unit to select it, then click a tile to retask.
- Contain the fires before they reach the base.

## Notes
- Leaderboard is stored in localStorage on this browser.
- Seed is shown in the top bar for repeatable maps.
- 2D rendering is deprecated and kept only for compatibility behind `?render=2d`.
