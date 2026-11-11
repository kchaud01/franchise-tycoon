# Franchise Tycoon — Developer Reference

A stadium-district sim driven by a Sleeper fantasy football league. Solo play is client-only (one HTML file, no image assets). League mode adds `server.js`, a dependency-free Node server that holds one shared game per fantasy league and posts weekly bonus-point tables. See `README.md` for hosting.

## Commands
- `node build.js` — bundle `src/` into `dist/franchise-tycoon.html` (double-click to play) and `dist/artifact.html` (same page without the document wrapper).
- `dist/gallery.html` (also built by `node build.js`) — every building level drawn with `FT.drawPreview()`, from `src/gallery.html` and `src/gallery.js`.
- `npm start` — build, then run the league server on `http://localhost:8787` (`DEMO=1` allows demo leagues).
- `npm test` — engine rules, balance readout, the Sleeper normalizer against mocked responses, and league-server rules.
- `npm run test:browser` — Playwright click-through of the built page (needs network for the last step).
- `npm run shots` — screenshots into `shots/`.

## Layout
- `src/engine.js` — all game rules. Pure functions over plain JSON state; runs in Node. **Every number that affects money, hype, fans or value lives here.** The UI never computes them.
- `src/league.js` — Sleeper API client and demo-season generator. Both produce the same normalized `league` object (documented at the top of the file).
- `src/render.js` — the isometric canvas renderer. Buildings are drawn in code from boxes and wall rectangles.
- `src/app.js` — DOM interface, save/load (`localStorage` key `franchise-tycoon-v1`), setup flow.
- `src/style.css`, `src/body.html` — page shell. Single dark theme by design.

## Rules worth knowing
- Grid is 5×5, lot keys are `"row-col"`, the stadium occupies `1-1, 1-2, 2-1, 2-2`.
- Tiles are a strict 2:1 isometric projection (`HW = 60`, `HH = 30` in `render.js`). Lots draw back to front by `row + col`; the stadium draws once all lots with `row + col <= 3` are done.
- A week is playable only when Sleeper has finalized it (`week < state.week`). The in-progress week shows live scores but cannot be played.
- Home or away is a deterministic hash of week and the two roster ids, so both sides of a matchup agree.
- Rival franchises (`state.rivals`) run the same `settle()` on their own fantasy results, then `aiTurn()`.
- Do not add a build step or dependencies; the output must stay a single self-contained HTML file.
- The town ring around the district (`TOWN_PLAN` / `TOWN` in `render.js`) is scenery only: no rules read it. Back rows hold the tall skyline; front rows stay low so they never hide the lots.
- Night games: `weekResult().night` (about 38% of regular-season games, every playoff game). Broadcast +25%, home concessions +10%. The renderer has no separate night art: every colour passes through `tone()`, which darkens surfaces at night and keeps the colours in `EMIT` lit. Add new light colours to `EMIT`.
- Map view: wheel or the +/− buttons zoom, drag pans (`zoomBy`, `panBy`, `resetView`).

## League mode
- `server.js` is authoritative: it reads Sleeper itself, stores state in `data/leagues.json`, and runs the same `engine.js`. The page only sends actions (`POST /api/act`) and renders the view it gets back.
- Identity is a private link per owner (`/#token`). The commissioner's token has `admin`. There are no passwords.
- Weekly cycle: open (build, price, promo) → locked at the commissioner's lock day and hour, Eastern time → settled for everyone when Sleeper finalizes the week.
- Bonus table: `FT.bonusTable()`. Each owner's weekly net is compared with an auto-pilot twin (`aiTurn`) that had the same fantasy result; rank by that edge decides the bonus. The sim always uses raw Sleeper scores, never bonus-adjusted ones.
- Commissioner settings live in `lg.settings` (`cleanSettings` in `server.js` validates them): cap, payout shape, playoff start, last week, playoff bonuses, lock day and hour.
- Trades: `league.trades` (completed Sleeper trades per week) and `league.ppw` (player points per week). `FT.tradeImpact()` values each player by scoring average above `REPLACEMENT` before the trade week; `settle()` turns the net into hype, home demand and merchandise for that week. The auto-pilot twin gets the same effect, so trades never move the bonus table.
- Travelling fans: `FT.attachTravel()` must run before any franchise settles a week. Visitors only take seats the home crowd left empty. In league mode the seated share becomes `lg.cut[week][homeRid]`, a percentage off the bonus the home owner uses in that matchup, capped by `settings.travelCut`.
- City visits: board rows carry a public `district` (grid, stadium, colour). The page swaps `renderer.state` to it; nothing is editable while visiting.
