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
- The town ring around the district (`TOWN_PLAN` / `TOWN` in `render.js`) is scenery only: no rules read it. It has five tiers keyed to the stadium level (farm village → metropolis): each `TOWN_PLAN` lot lists what stands there per tier, and `BUSY` sets cars, walkers and lamps. Back rows hold the tall skyline; front rows stay low so they never hide the lots.
- Night games: `weekResult().night` (about 38% of regular-season games, every playoff game). Broadcast +25%, home concessions +10%. The renderer has no separate night art: every colour passes through `tone()`, which darkens surfaces at night and keeps the colours in `EMIT` lit. Add new light colours to `EMIT`.
- Map view: wheel or the +/− buttons zoom, drag pans (`zoomBy`, `panBy`, `resetView`).

## League mode
- `server.js` is authoritative: it reads Sleeper itself, stores state in `data/leagues.json`, and runs the same `engine.js`. The page only sends actions (`POST /api/act`) and renders the view it gets back.
- Identity is a private link per owner (`/#token`). The commissioner's token has `admin`. There are no passwords.
- Weekly cycle: open (build, price, promo) → locked at the commissioner's lock day and hour, Eastern time → settled for everyone when Sleeper finalizes the week.
- Bonus table: `FT.bonusTable()`. Each owner's weekly net is compared with an auto-pilot twin (`aiTurn`) that had the same fantasy result; rank by that edge decides the bonus. The sim always uses raw Sleeper scores, never bonus-adjusted ones.
- League format: `settings.mode` is `bonus` (sim adds to fantasy scores) or `sim` (standings only; tables are stored unpaid and no score sheet is produced). The sim scoreboard is the season ledger on each board row (`gross`, `net`), ranked by `settings.simMetric`; `settings.prize` is free text.
- Score sheet: `sheets(lg)` in `server.js` pre-calculates each team's new score for every week that carries bonuses (earned bonus, less the visiting-fan cut, or the commissioner's `lg.override[week][rid]`). The page never recomputes it.
- Commissioner settings live in `lg.settings` (`cleanSettings` in `server.js` validates them): cap, payout shape, playoff start, last week, playoff bonuses, lock day and hour.
- Trades: `league.trades` (completed Sleeper trades per week) and `league.ppw` (player points per week). `FT.tradeImpact()` values each player by scoring average above `REPLACEMENT` before the trade week; `settle()` turns the net into hype, home demand and merchandise for that week. The auto-pilot twin gets the same effect, so trades never move the bonus table.
- Travelling fans: `FT.attachTravel()` must run before any franchise settles a week. Visitors only take seats the home crowd left empty. In league mode the seated share becomes `lg.cut[week][homeRid]`, a percentage off the bonus the home owner uses in that matchup, capped by `settings.travelCut`.
- City visits: board rows carry a public `district` (grid, stadium, colour). The page swaps `renderer.state` to it; nothing is editable while visiting.
- Upgrade art: each level in `DRAW` (and each stadium tier in `TIERS` / `drawStadium`) is a different kind of place, not a taller copy: cart → food court → restaurant, lot → garage → rail terminal, field → bowl → stadium → roofed arena → dome. Keep `heightOf()` in step with any new art; hit-testing and gallery scaling read it.
- Mini-games: `src/minigames.js` holds the eight games and the overlay runner (`FT.Mini.open`). Each game is a plain object (`update`, `draw`, `down`, `up`, `key`, `done`, `score`) with no DOM access outside `draw`, so `test/mini.js` plays them headless with random and skilled bots. Rules live in `engine.js`: `MINI` (names, medal thresholds), `recordMini()` (three counted tries a week, building must be owned), and the boost is applied in `effects()` and cleared in `settle()`. In league mode the score is reported by the browser (`a: 'mini'`), which is why the boost is capped at 10% and `settings.miniBoost` can switch it off. When adding a game, add a skilled bot to `test/mini.js` proving gold is reachable.
- City look: each franchise carries `color`, `color2` and `setting` (`metro`, `mountain`, `river`, `beach`). All three are cosmetic: no rule reads them. `sceneryKind()` in `render.js` swaps scenery lots per setting (peaks and a lodge on the back rows, a river on the front row, beach on both front sides) and `drawGround` paints the terrain; `TRIM` is the secondary colour while a frame is drawn. League servers accept `a: 'style'` at any time, and the look is public on board rows.
- Visiting: buildings in another owner's city open their mini-game in guest mode (`playMini(type, guest)`), which never calls `recordMini` or the server.
- Deals between owners (`engine.js`, "Deals between owners"): every deal line in `settle()` is tagged `deal: true` and summed into `rep.deals`. Deal inputs are attached to the week's `results` (`r.trade`, `r.wager`, `r.rail`), so the auto-pilot twin settles the same lines and deals never move the bonus edge. Keep it that way for any new deal.
  - Transfer fee: the side that gained star power in a real trade pays `TRADE_FEE` per point a game; star power sums to zero across a trade, so the fee is zero-sum. `tradeNews()` writes the headline.
  - Matchup wagers: open until the first points are scored (`wagerOpen`). League: `a: 'wager' | 'wagerReply' | 'wagerCancel'`, settled in `settleReady` via `attachWager`; unanswered offers expire at settlement. Solo: `offerWagerSolo`, rivals decide on season points.
  - Rail links: both sides need a level-`RAIL_LEVEL` Transit Hub and pay `RAIL_COST`; up to `RAIL_MAX` links. Linked cities double travelling fans between them and earn weekly tourism from each other's fanbase. League: `a: 'rail' | 'railReply' | 'railCancel'`. Solo: rivals always agree, and the player covers a rival's half when it is short of cash (`railPriceSolo`).
- Demo leagues hide each unplayed week's scores (`wk.hidden`) until `setDemoWeek` reaches it, so the in-progress week shows 0–0 and wagers can open.
- The city shows a trade: `renderer.mood` draws a welcome banner or a protest for the week shown, and `renderer.rails` draws an elevated line toward each linked city.
- The Daily Herald: `FT.weekStories()` writes the week's stories (upsets, photo finishes, routs, player of the week, streaks, paydays, sellouts, milestones) from the fantasy results and every franchise's settle report; trades, wagers and rail links add their own items. Every item is `{week, kind, weight, head, body}` and the edition leads with the heaviest. Solo pushes them into `S.news` in `playWeek`; league servers push them into `lg.news` in `settleReady`. The paper itself (`heraldHTML` in `app.js`) is a fixed newsprint look in both themes.
- Travel between cities: `travelTo(dest)` in `app.js` snapshots the current city, switches to the destination, snapshots it, and hands both to `renderer.travel()`. While `renderer.trip` runs, `draw()` shows `drawTrip()` instead (zoom out, cross the map by plane, or by train when the cities are rail-linked, zoom in) and map clicks are ignored. Reduced-motion users switch instantly.
- Life around buildings: `LIFE[type]` in `render.js` draws each building's people and vehicles right after its art (queues at food stalls, shoppers with bags, a limo at the suites, an ambulance, a landing helicopter, rooftop runners, cheering fans), and `drawFans` sends fans across the stadium plaza. Counts come from `crowd(base, perLevel, level, busy)`, where `busyOf()` blends hype and attendance, so a winning, full district looks busier. Purely visual: no rule reads it.
