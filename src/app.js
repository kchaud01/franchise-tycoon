/* Franchise Tycoon — interface. Wires the engine, league data and renderer to the page. */
(function () {
  'use strict';
  const FT = window.FT;
  const SAVE_KEY = 'franchise-tycoon-v1';
  const COLORS = ['#e4572e', '#f2b33d', '#3aa88f', '#4f8fd9', '#b06ab3', '#d9436b', '#5aa845', '#d8d2c2'];
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => {
    const a = Math.abs(n), s = n < 0 ? '-' : '';
    return s + '$' + (a >= 1e6 ? (a / 1e6).toFixed(2) + 'M' : a >= 1e3 ? Math.round(a / 1e3) + 'k' : Math.round(a));
  };
  const num = (n) => Math.round(n).toLocaleString();

  let S = null, L = null, conn = null;          // franchise state, league data, Sleeper connection
  let visiting = null;                          // roster id of the city on screen when it is not your own
  let tab = 'game', selected = null, renderer = null, busy = false, notice = '', setup = { step: 'start', color: COLORS[0] };

  // ---- persistence ---------------------------------------------------------------------
  function save() {
    if (LG) return; // league mode: the server holds the game
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ S, L, conn })); } catch (e) { /* storage may be unavailable; the game still runs */ }
  }
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (d && d.S && d.L && d.S.v === 1) { S = d.S; L = d.L; conn = d.conn || null; return true; }
    } catch (e) { /* ignore a corrupt save */ }
    return false;
  }
  function wipe() { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* nothing to clear */ } S = L = conn = null; }

  // ---- setup ----------------------------------------------------------------------------
  function swatches() {
    return '<div class="swatches" role="radiogroup" aria-label="Team colour">' + COLORS.map((c) =>
      '<button type="button" class="swatch' + (c === setup.color ? ' on' : '') + '" style="background:' + c + '" data-act="color" data-v="' + c + '" aria-label="Team colour ' + c + '" aria-pressed="' + (c === setup.color) + '"></button>').join('') + '</div>';
  }
  function renderSetup() {
    const el = $('#setup');
    let h = '';
    const userForm = '<form id="connect" class="connect"><label for="username">Sleeper username</label><div class="row"><input id="username" name="username" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="your_sleeper_name" value="' + esc(setup.username || '') + '"><button class="btn primary" type="submit"' + (busy ? ' disabled' : '') + '>' + (busy ? 'Looking…' : 'Find my leagues') + '</button></div></form>';
    if (setup.step === 'lguser') {
      h = '<p class="lede"><b>Start a league season.</b> You are setting this up as commissioner. Every owner gets a private link, all franchises start level from the next unplayed week, and the server posts a bonus table each week.</p>' + userForm + (setup.error ? '<p class="error" role="alert">' + esc(setup.error) + '</p>' : '') + '<button class="btn ghost" data-act="back">Back</button>';
    } else if (setup.step === 'lgconfirm') {
      const lg = setup.league;
      h = '<p class="lede"><b>' + esc(lg.name) + '</b> · ' + lg.teams.length + ' teams. Check the league rules, then create the season. You can change all of this later on the Admin tab.</p>' +
        settingsForm({ cap: 5, travelCut: 0.5, payout: 'all', playoffStart: lg.playoffStart, lastWeek: lg.lastWeek, playoffBonus: false, lockDay: 4, lockHour: 20 }, null) +
        (server && server.needsKey ? '<div class="field"><label for="lg-key">Server key</label><input id="lg-key" type="password" autocomplete="off"></div>' : '') +
        (setup.error ? '<p class="error" role="alert">' + esc(setup.error) + '</p>' : '') +
        '<div class="row end"><button class="btn ghost" data-act="back">Back</button><button class="btn primary" data-act="lgcreate"' + (busy ? ' disabled' : '') + '>Create league season</button></div>';
    } else if (setup.step === 'start') {
      h = '<p class="lede">Your fantasy team is the franchise. Every week Sleeper finalizes a score, and that score fills your stadium, sells your jerseys and sets your suite prices. You build the district around it.</p>' +
        '<form id="connect" class="connect"><label for="username">Sleeper username</label><div class="row"><input id="username" name="username" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="your_sleeper_name" value="' + esc(setup.username || '') + '"><button class="btn primary" type="submit"' + (busy ? ' disabled' : '') + '>' + (busy ? 'Looking…' : 'Find my leagues') + '</button></div></form>' +
        (setup.error ? '<p class="error" role="alert">' + esc(setup.error) + '</p>' : '') +
        '<div class="or"><span>or</span></div>' +
        '<button class="btn ghost wide" data-act="demo">Play the demo league</button>' +
        '<p class="fine">The demo is a generated ten-team season, nine weeks in. No account needed.</p>' +
        (server ? '<div class="or"><span>league mode</span></div><button class="btn ghost wide" data-act="lgstart">Start a league season (commissioner)</button>' + (server.demo ? '<button class="btn ghost wide" data-act="lgdemo">Try league mode with a demo league</button>' : '') + '<p class="fine">Owners join with the private link their commissioner sends them.</p>' : '');
    } else if (setup.step === 'leagues') {
      h = '<p class="lede">Leagues for <b>' + esc(setup.found.user.name) + '</b>, ' + esc(setup.found.season) + ' season. Pick the one to build on.</p><div class="pick">' +
        setup.found.leagues.map((l) => '<button class="pickrow" data-act="league" data-v="' + esc(l.id) + '"' + (busy ? ' disabled' : '') + '><b>' + esc(l.name) + '</b><span>' + esc(l.size) + ' teams · ' + esc(String(l.status).replace('_', ' ')) + '</span></button>').join('') +
        '</div>' + (busy ? '<p class="fine">Loading the season from Sleeper…</p>' : '') + (setup.error ? '<p class="error" role="alert">' + esc(setup.error) + '</p>' : '') +
        '<button class="btn ghost" data-act="back">Back</button>';
    } else if (setup.step === 'team') {
      const lg = setup.league, done = Object.values(lg.weeks).filter((w) => w.complete).length;
      h = '<p class="lede"><b>' + esc(lg.name) + '</b> · ' + done + (done === 1 ? ' finished week' : ' finished weeks') + ' ready to play as game days.</p>' +
        '<label for="team">Your team</label><select id="team">' + lg.teams.map((t) => '<option value="' + t.rosterId + '"' + (t.rosterId === lg.myRosterId ? ' selected' : '') + '>' + esc(t.name) + (t.owner ? ' (' + esc(t.owner) + ')' : '') + '</option>').join('') + '</select>' +
        '<label>Team colour</label>' + swatches() +
        '<div class="row end"><button class="btn ghost" data-act="back">Back</button><button class="btn primary" data-act="begin">Break ground</button></div>';
    }
    el.querySelector('.setup-body').innerHTML = h;
  }
  async function connect(username) {
    busy = true; setup.error = ''; setup.username = username; renderSetup();
    try {
      const found = await FT.Sleeper.findLeagues(username);
      if (!found.leagues.length) throw new Error('That account has no NFL leagues for ' + found.season + '.');
      setup.found = found; setup.step = 'leagues';
    } catch (e) {
      setup.error = e.code === 'network' ? 'Sleeper cannot be reached from this page. If you are viewing the published preview, open the downloaded game file in your browser instead, or play the demo league.' : e.message;
    }
    busy = false; renderSetup();
  }
  async function chooseLeague(id) {
    busy = true; setup.error = ''; renderSetup();
    try {
      const lg = await FT.Sleeper.loadLeague(id, setup.found.user.id);
      if (lg.myRosterId == null) lg.myRosterId = lg.teams[0].rosterId;
      setup.league = lg; setup.conn = { userId: setup.found.user.id, username: setup.found.user.name, leagueId: id }; setup.step = setup.forLeague ? 'lgconfirm' : 'team';
    } catch (e) { setup.error = e.message; }
    busy = false; renderSetup();
  }
  async function createLeague(body, settings) {
    busy = true; setup.error = ''; renderSetup();
    try {
      const out = await api('leagues', body);
      LG = { token: out.token };
      let view = await api('state');
      if (settings) { LG.view = view; view = await api('act', { a: 'settings', v: settings }); }
      busy = false; setup.forLeague = false; enterLeague(view, out.token);
    } catch (e) { LG = null; busy = false; setup.error = e.message; renderSetup(); }
  }
  function begin(league, connection) {
    L = league; conn = connection;
    S = FT.newGame(L, { color: setup.color });
    tab = 'game'; selected = null; notice = '';
    save(); showGame();
    if (L.source === 'sleeper') fetchNames();
  }
  function fetchNames() {
    FT.Sleeper.loadNames(L).then((changed) => { if (changed) { save(); render(); } }).catch(() => { /* names are a nicety */ });
  }
  async function sync() {
    if (!L || busy) return;
    if (L.source !== 'sleeper') { notice = 'The demo league has no live feed. Use "Skip ahead a week" on the Game Day tab.'; render(); return; }
    busy = true; notice = 'Checking Sleeper…'; render();
    try {
      const fresh = await FT.Sleeper.loadLeague(conn.leagueId, conn.userId);
      fresh.myRosterId = L.myRosterId; fresh.players = L.players || {};
      L = fresh; notice = 'Synced with Sleeper just now.';
      save(); fetchNames();
    } catch (e) { notice = e.code === 'network' ? 'Sleeper cannot be reached from this page, so the league was not refreshed.' : e.message; }
    busy = false; render();
  }

  // ---- game views ---------------------------------------------------------------------
  function hud() {
    const board = LG ? LG.view.board : FT.leaderboard(S, L), rank = board.findIndex((x) => x.me) + 1;
    $('#hud-name').textContent = S.name;
    $('#hud-league').textContent = L.name + ' · ' + L.season + (LG ? ' · League mode' : '');
    $('#hud-stats').innerHTML =
      stat('Cash', money(S.cash), S.cash < 0 ? 'bad' : '') + stat('Fans', num(S.fans)) +
      '<div class="stat"><span>Hype</span><b>' + Math.round(S.hype) + '</b><i class="meter"><i style="width:' + S.hype + '%"></i></i></div>' +
      stat('Value', money(FT.value(S))) + stat('League rank', '#' + rank + ' of ' + board.length);
  }
  const stat = (k, v, cls) => '<div class="stat ' + (cls || '') + '"><span>' + k + '</span><b>' + v + '</b></div>';

  /** One line on what this week's trade did, shown before and after the game. */
  function tradeLine(tr) {
    if (!tr) return '';
    const nm = (x) => esc(x.n || 'a player') + (x.avg ? ' (' + x.avg.toFixed(1) + ' a game)' : '');
    const mood = tr.net >= 1 ? 'Fans are buzzing: hype, the home crowd and jersey sales all get a lift.' : tr.net <= -1 ? 'Fans are not happy: hype and the home crowd take a hit.' : 'Fans shrug: an even swap.';
    return '<p class="linkline"><b>Trade this week.</b> ' + (tr.in.length ? 'In: ' + tr.in.map(nm).join(', ') + '. ' : '') + (tr.out.length ? 'Out: ' + tr.out.map(nm).join(', ') + '. ' : '') + mood + '</p>';
  }
  /** Travelling support for the game on screen. t = {in} when hosting, {out} when away. */
  function travelLine(t) {
    if (!t) return '';
    if (t.out != null) return '<p class="fine">About <b>' + num(t.out) + '</b> of your fans will travel. They sell road merchandise, lift hype' + (LG ? ', and every seat they take cuts the bonus your opponent can use against you' : '') + '. Hype, a Transit Hub and a win streak send more.</p>';
    return '<p class="fine">Up to <b>' + num(t.in) + '</b> visiting fans want in. They only get seats your own crowd leaves empty' + (LG ? ', and each one cuts the bonus you bring into this matchup. A full house keeps them out' : '') + '.</p>';
  }
  function soloTravel(r) {
    const opp = S.rivals && S.rivals[r.oppId];
    return !opp || r.bye ? null : r.home ? { in: FT.travelers(opp, S) } : { out: FT.travelers(S, opp) };
  }
  function crowdCard(f) {
    const lim = f.demand > f.attendance ? (f.access < f.capacity ? 'Road access is the limit. A Transit Hub lets more fans in.' : 'The stadium is the limit. Expand it or raise prices.') : 'Demand is the limit. Hype and a bigger fanbase fill seats.';
    return '<div class="card"><h3>Expected crowd</h3><div class="bars">' +
      bar('Demand', f.demand, Math.max(f.demand, f.capacity, f.access)) + bar('Stadium seats', f.capacity, Math.max(f.demand, f.capacity, f.access)) + bar('Road access', f.access, Math.max(f.demand, f.capacity, f.access)) +
      '</div><p class="fine">About <b>' + num(f.attendance) + '</b> through the gates. ' + lim + '</p>' +
      '<h3>Ticket price</h3><div class="seg" role="radiogroup" aria-label="Ticket price">' + FT.PRICES.map((p) =>
        '<button data-act="price" data-v="' + p.id + '" class="' + (S.price === p.id ? 'on' : '') + '" aria-pressed="' + (S.price === p.id) + '"><b>' + p.name + '</b><span>$' + p.price + ' · ' + (p.turnout > 1 ? '+15% crowd' : p.turnout < 1 ? '-20% crowd' : 'normal crowd') + '</span></button>').join('') + '</div></div>';
  }
  function promoCard(r) {
        return '<div class="card"><h3>Promotion</h3><div class="promos">' + Object.keys(FT.PROMOS).map((id) => {
      const p = FT.PROMOS[id], off = p.cost > S.cash || (id === 'giveaway' && !r.home);
      return '<button data-act="promo" data-v="' + id + '" class="' + (S.promo === id ? 'on' : '') + '"' + (off ? ' disabled' : '') + ' aria-pressed="' + (S.promo === id) + '"><b>' + p.name + '</b><span>' + p.text + '</span><em>' + (p.cost ? money(p.cost) : 'Free') + '</em></button>';
    }).join('') + '</div></div>';
  }
  function viewGame() {
    if (LG) return viewGameLeague();
    const nx = FT.nextWeek(S, L), f = FT.forecast(S);
    let h = '';
    if (nx.status === 'ready') {
      const r = nx.result;
      const kind = r.bye ? 'Bye week' : r.home ? 'Home game' : 'Away game';
      h += '<div class="card match"><div class="kicker">Week ' + nx.week + (r.playoff ? ' · Playoffs' : '') + ' · ' + kind + (r.bye ? '' : r.night ? ' · Night' : ' · Afternoon') + '</div>' +
        '<h2>' + (r.bye ? 'No opponent this week' : (r.home ? 'vs ' : 'at ') + esc(r.oppName)) + '</h2>' +
        '<p>' + (r.bye ? 'Merchandise and the league share still come in.' : r.home ? 'The final score is in from ' + (L.source === 'demo' ? 'the demo league' : 'Sleeper') + '. Set prices, pick a promotion, then open the gates.' : 'No ticket sales on the road. Your Fan Plaza hosts the watch party and the Broadcast Center sells the feed.') + '</p>' +
        tradeLine(r.trade) + travelLine(soloTravel(r)) +
        (r.night && !r.bye ? '<p class="linkline">Prime-time night game: broadcast rights pay +25%' + (r.home ? ' and concessions +10%.' : '.') + '</p>' : '') +
        (nx.backlog > 1 ? '<p class="pill">' + nx.backlog + ' finished weeks waiting to be played</p>' : '') + '</div>';
      if (r.home) h += crowdCard(f);
      if (!r.bye) h += promoCard(r);
      h += miniList();
      h += '<button class="btn primary big" data-act="play">' + (r.bye ? 'Play the bye week' : r.home ? 'Open the gates' : 'Play the away game') + '</button>';
    } else if (nx.status === 'done') {
      h += '<div class="card match"><div class="kicker">' + esc(L.season) + ' season</div><h2>Season complete</h2><p>Final record ' + S.wins + '-' + S.losses + ' across everything you have played. Your district carries over.</p></div>' +
        (L.source === 'demo' ? '<button class="btn primary big" data-act="newseason">Start the next demo season</button>'
          : '<p class="fine">When your league renews on Sleeper, use Switch league in the menu and pick the new season. Your franchise comes with you.</p><button class="btn ghost wide" data-act="sync">Check Sleeper again</button>');
    } else {
      const me = nx.wk && nx.wk.teams[S.rid];
      let live = '';
      if (me) {
        const opp = Object.keys(nx.wk.teams).map(Number).find((id) => id !== S.rid && nx.wk.teams[id].mid === me.mid && me.mid != null);
        live = '<div class="live"><div><span>' + esc(S.name) + '</span><b>' + me.pts.toFixed(1) + '</b></div><div><span>' + esc(opp != null ? FT.teamName(L, opp) : 'Bye') + '</span><b>' + (opp != null ? nx.wk.teams[opp].pts.toFixed(1) : '-') + '</b></div></div>';
      }
      h += '<div class="card match"><div class="kicker">Week ' + nx.week + ' · ' + (nx.status === 'live' ? 'In progress' : 'Not started') + '</div><h2>Waiting on the final whistle</h2>' + live +
        '<p>Game day opens once ' + (L.source === 'demo' ? 'the demo week ends' : 'Sleeper finalizes Week ' + nx.week + ', usually Tuesday morning') + '. Until then, build with what you have.</p></div>' +
        (L.source === 'demo' ? '<button class="btn primary big" data-act="skip">Skip ahead a week</button>' : '<button class="btn primary big" data-act="sync"' + (busy ? ' disabled' : '') + '>Sync with Sleeper</button>');
    }
    if (notice) h += '<p class="fine notice" role="status">' + esc(notice) + '</p>';
    return h;
  }
  const bar = (label, v, max) => '<div class="bar"><span>' + label + '</span><i><i style="width:' + Math.max(3, (v / max) * 100) + '%"></i></i><b>' + num(v) + '</b></div>';

  function viewBuild() {
    const html = viewBuildInner();
    if (!LG || LG.view.phase === 'open') return html + (LG && notice ? '<p class="fine notice" role="status">' + esc(notice) + '</p>' : '');
    return '<div class="card"><p class="pill">Locked until Week ' + LG.view.week + ' settles</p><p class="fine">Building reopens for every owner at the same moment.</p></div>' + html.replace(/data-act="(build|upgrade|stadium|demolish)"/g, 'disabled data-act="$1"');
  }
  // ---- mini-games ------------------------------------------------------------------------
  const MEDAL_CLASS = ['', 'm1', 'm2', 'm3'];
  function miniState(type) { return (S.mini && S.mini[type]) || { tries: 0, medal: 0, boost: 0 }; }
  function miniOpen() { return !LG || LG.view.phase === 'open'; }
  function miniOn() { return !LG || LG.view.settings.miniBoost !== false; }
  function miniStatus(type) {
    const m = miniState(type), left = FT.MINI_TRIES - m.tries, d = FT.BUILDINGS[type];
    if (!miniOpen()) return 'The week is locked, so this is practice only.';
    const best = m.medal ? 'Best so far: ' + FT.MEDALS[m.medal] + (miniOn() ? ', ' + d.name + ' +' + Math.round(m.boost * 100) + '% this game day.' : '.') : 'No medal yet.';
    return (left > 0 ? left + (left === 1 ? ' try' : ' tries') + ' left this week. ' : 'No tries left this week: playing on is just for fun. ') + best;
  }
  function miniCard(type) {
    const g = FT.MINI[type], m = miniState(type), left = FT.MINI_TRIES - m.tries, t = g.tiers;
    return '<div class="card minicard"><div class="kicker">Mini-game</div><h3 class="minih">' + esc(g.name) + (m.medal ? ' <i class="medal ' + MEDAL_CLASS[m.medal] + '">' + FT.MEDALS[m.medal] + '</i>' : '') + '</h3><p class="fine">' + esc(g.how) + '</p>' +
      '<p class="fine">Bronze ' + t[0] + ', silver ' + t[1] + ', gold ' + t[2] + ' ' + g.unit + (g.lower ? ' or faster' : '') + '. ' + (miniOn() ? 'A medal lifts this building by 4%, 7% or 10% for the next game day.' : 'Your commissioner has medals set to bragging rights only.') + '</p>' +
      '<button class="btn ' + (left > 0 && miniOpen() ? 'primary' : 'ghost') + ' wide" data-act="mini" data-v="' + type + '">' + (left > 0 && miniOpen() ? 'Play · ' + left + (left === 1 ? ' try left' : ' tries left') : 'Play for fun') + '</button></div>';
  }
  function miniList() {
    const owned = FT.TYPES.filter((t) => Object.values(S.grid).some((b) => b.type === t));
    if (!owned.length) return '';
    return '<div class="card"><h3>Mini-games</h3><p class="fine">One per building you own. Three tries each per week; your best medal boosts that building on game day.</p><div class="minis">' + owned.map((t) => {
      const m = miniState(t), left = FT.MINI_TRIES - m.tries;
      return '<button data-act="mini" data-v="' + t + '"><b>' + esc(FT.MINI[t].name) + '</b><em>' + (m.medal ? '<i class="medal ' + MEDAL_CLASS[m.medal] + '">' + FT.MEDALS[m.medal] + '</i>' : left + ' left') + '</em><span>' + FT.BUILDINGS[t].name + (m.boost && miniOn() ? ' +' + Math.round(m.boost * 100) + '%' : '') + '</span></button>';
    }).join('') + '</div></div>';
  }
  function playMini(type) {
    const g = FT.MINI[type];
    FT.Mini.open({
      game: g.game, title: g.name, building: FT.BUILDINGS[type].name, how: g.how, color: S.color,
      status: () => miniStatus(type),
      onClose: () => render(),
      onFinish: async (score) => {
        const medal = FT.miniMedal(type, score), before = miniState(type);
        let counted = false;
        if (miniOpen() && before.tries < FT.MINI_TRIES) {
          if (LG) { try { applyView(await api('act', { a: 'mini', type, score })); counted = true; } catch (e) { notice = e.message; } }
          else { counted = FT.recordMini(S, type, score).counted; save(); }
        }
        const after = miniState(type);
        const line = !counted ? FT.MEDALS[medal] + '. Practice run, nothing recorded.' : medal > before.medal ? FT.MEDALS[medal] + ' medal!' + (miniOn() ? ' ' + FT.BUILDINGS[type].name + ' +' + Math.round(after.boost * 100) + '% on the next game day.' : '') : medal ? FT.MEDALS[medal] + '. Your best this week stays ' + FT.MEDALS[after.medal] + '.' : 'No medal this time.';
        return { score: (g.lower ? score.toFixed(2) : score) + ' ' + g.unit, medal, line, triesLeft: FT.MINI_TRIES - after.tries };
      },
    });
  }

  function viewBuildInner() {
    if (!selected) {
      return '<div class="card"><h3>Pick a lot on the map</h3><p>Empty lots have dashed outlines. Tap one to build, tap a building to upgrade it, or tap the stadium to expand it.</p></div>' +
        '<div class="card"><h3>What each building does</h3><ul class="catalog">' + FT.TYPES.map((t) => { const b = FT.BUILDINGS[t]; return '<li><b>' + b.name + '</b> <em>' + money(b.cost[0]) + '</em><span>' + b.link + '</span></li>'; }).join('') + '</ul></div>';
    }
    if (selected === 'stadium') {
      const lv = S.stadium, max = lv >= 5, cost = FT.STADIUM.cost[lv];
      return '<div class="card"><div class="kicker">Stadium · Level ' + lv + ' of 5</div><h2>' + FT.STADIUM.name[lv - 1] + '</h2><p>Seats <b>' + num(FT.STADIUM.cap[lv - 1]) + '</b>. Ticket sales, concessions and suites all depend on how many fans fit inside.</p>' +
        (max ? '<p class="pill">Fully expanded</p>' : '<p>Next: <b>' + FT.STADIUM.name[lv] + '</b>, ' + num(FT.STADIUM.cap[lv]) + ' seats.</p><button class="btn primary wide" data-act="stadium"' + (S.cash < cost ? ' disabled' : '') + '>Expand for ' + money(cost) + '</button>' + (S.cash < cost ? '<p class="fine">You need ' + money(cost - S.cash) + ' more.</p>' : '')) + '</div>';
    }
    const b = S.grid[selected], pos = 'Lot ' + selected.replace('-', ',') + (FT.nearStadium(selected) ? ' · beside the stadium' : FT.onEdge(selected) ? ' · outer edge' : '');
    if (b) {
      const d = FT.BUILDINGS[b.type], syn = FT.synergy(S, selected, b.type), max = b.level >= 3, cost = d.cost[b.level];
      return '<div class="card"><div class="kicker">' + pos + '</div><h2>' + d.name + ' <small>Level ' + b.level + '</small></h2><p>' + d.blurb + '</p><p class="linkline">' + d.link + '</p>' +
        '<dl class="facts"><div><dt>Now</dt><dd>' + d.unit(d.v[b.level - 1]) + '</dd></div>' + (max ? '' : '<div><dt>Level ' + (b.level + 1) + '</dt><dd>' + d.unit(d.v[b.level]) + '</dd></div>') +
        '<div><dt>Placement</dt><dd class="' + (syn > 1 ? 'good' : '') + '">' + (syn > 1 ? '+' + Math.round((syn - 1) * 100) + '% bonus active' : d.synergy) + '</dd></div></dl>' +
        (max ? '<p class="pill">Fully upgraded</p>' : '<button class="btn primary wide" data-act="upgrade"' + (S.cash < cost ? ' disabled' : '') + '>Upgrade for ' + money(cost) + '</button>') +
        '<button class="btn ghost wide" data-act="demolish">' + (setup.confirm === selected ? 'Tap again to demolish' : 'Demolish, refund ' + money(FT.refund(b))) + '</button></div>' + miniCard(b.type);
    }
    return '<div class="card"><div class="kicker">' + pos + '</div><h2>Empty lot</h2><div class="options">' + FT.TYPES.map((t) => {
      const d = FT.BUILDINGS[t], syn = FT.synergy(S, selected, t), off = S.cash < d.cost[0];
      return '<button data-act="build" data-v="' + t + '"' + (off ? ' disabled' : '') + '><b>' + d.name + '</b><em>' + money(d.cost[0]) + '</em><span>' + d.blurb + '</span><span class="syn ' + (syn > 1 ? 'good' : '') + '">' + (syn > 1 ? 'Here: +' + Math.round((syn - 1) * 100) + '% placement bonus' : d.synergy) + '</span></button>';
    }).join('') + '</div></div>';
  }

  /** Another owner's city, as the renderer needs it. In league mode it is their real district from the server. */
  function boardRows() { return LG ? LG.view.board : FT.leaderboard(S, L); }
  function districtOf(row) {
    if (row.district) return row.district;
    const f = S.rivals && S.rivals[row.rid];
    if (!f) return null;
    const fc = FT.forecast(f);
    return { grid: f.grid, stadium: f.stadium, color: COLORS[(row.rid * 3 + 1) % COLORS.length], fill: Math.min(1, fc.attendance / fc.capacity) };
  }
  function visitBanner() {
    const el = $('#visit'), row = visiting != null && boardRows().find((x) => x.rid === visiting);
    if (!row || !districtOf(row)) { visiting = null; el.hidden = true; return null; }
    el.hidden = false;
    el.innerHTML = '<button class="btn ghost small" data-act="visitstep" data-v="-1" aria-label="Previous city">‹</button><div><span>Visiting</span><b>' + esc(row.name) + '</b><em>' + FT.STADIUM.name[row.stadium - 1] + ' · ' + num(row.fans) + ' fans · ' + row.lots + (row.lots === 1 ? ' lot' : ' lots') + ' built · ' + money(row.value) + '</em></div><button class="btn ghost small" data-act="visitstep" data-v="1" aria-label="Next city">›</button><button class="btn primary small" data-act="gohome">Back to my city</button>';
    return districtOf(row);
  }
  function viewLeague() {
    const rows = LG ? LG.view.board : FT.leaderboard(S, L);
    return '<div class="card"><h3>Franchise values</h3><p class="fine">' + (LG ? 'Every owner in the league runs their own franchise on the league server. These are their real districts.' : 'Every manager in your league runs a franchise off their own fantasy results. Rival owners build automatically.') + '</p>' +
      '<div class="scroll"><table><thead><tr><th>#</th><th>Franchise</th><th>Record</th><th>Fans</th><th>Value</th></tr></thead><tbody>' +
      rows.map((x, i) => '<tr class="' + (x.me ? 'me' : '') + '"><td>' + (i + 1) + '</td><td>' + (x.me ? esc(x.name) : '<button class="linkbtn" data-act="visit" data-v="' + x.rid + '">' + esc(x.name) + '</button>') + '</td><td>' + x.record + '</td><td>' + num(x.fans) + '</td><td>' + money(x.value) + '</td></tr>').join('') +
      '</tbody></table></div><p class="fine">Tap a franchise to visit its city.</p></div>';
  }

  function viewLedger() {
    const badges = FT.BADGES.map((b) => '<li class="' + (S.badges[b.id] ? 'got' : '') + '"><b>' + b.name + '</b><span>' + money(b.reward) + '</span></li>').join('');
    const hist = S.history.slice().reverse().map((rep, i) => {
      const r = rep.r;
      return '<button class="histrow" data-act="report" data-v="' + (S.history.length - 1 - i) + '"><span>Wk ' + r.week + '</span><b class="' + (r.bye ? '' : r.win ? 'good' : 'bad') + '">' + (r.bye ? 'BYE' : (r.win ? 'W ' : r.tie ? 'T ' : 'L ') + r.pts.toFixed(1) + '-' + r.oppPts.toFixed(1)) + '</b><span>' + (r.bye ? '' : (r.home ? 'vs ' : 'at ') + esc(r.oppName)) + '</span><em class="' + (rep.net < 0 ? 'bad' : '') + '">' + money(rep.net) + '</em></button>';
    }).join('');
    return '<div class="card"><h3>Game days</h3>' + (hist || '<p class="fine">Nothing played yet. Your first game day is on the Game Day tab.</p>') + '</div><div class="card"><h3>Milestones</h3><ul class="badges">' + badges + '</ul></div>';
  }

  function reportHTML(rep) {
    const r = rep.r, top = r.top && L.players && L.players[r.top.id];
    const chips = [];
    if (!r.bye) chips.push('League rank ' + r.rank + ' of ' + r.n + ' (' + r.record + ')');
    if (r.top) chips.push((top ? top.n : 'Top starter') + ' ' + r.top.pts.toFixed(1) + ' pts');
    if (r.stars) chips.push(r.stars + ' starter' + (r.stars > 1 ? 's' : '') + ' at 20+');
    if (r.trade) chips.push('Trade: ' + (r.trade.net >= 0 ? '+' : '') + r.trade.net.toFixed(1) + ' star power');
    Object.keys(rep.mini || {}).forEach((t) => { const m = rep.mini[t]; if (m.boost) chips.push(FT.MINI[t].name + ' ' + FT.MEDALS[m.medal].toLowerCase() + ': ' + FT.BUILDINGS[t].name + ' +' + Math.round(m.boost * 100) + '%'); });
    if (r.busts) chips.push(r.busts + ' bust' + (r.busts > 1 ? 's' : ''));
    let h = '<div class="kicker">Week ' + r.week + (r.playoff ? ' · Playoffs' : '') + ' · ' + (r.bye ? 'Bye' : r.home ? 'Home' : 'Away') + (r.night && !r.bye ? ' · Night game' : '') + ' · Final</div>';
    h += r.bye ? '<h2 class="final">Bye week</h2>' :
      '<h2 class="final ' + (r.win ? 'good' : r.tie ? '' : 'bad') + '">' + (r.win ? 'Win' : r.tie ? 'Tie' : 'Loss') + ' <span>' + r.pts.toFixed(1) + ' - ' + r.oppPts.toFixed(1) + '</span></h2><p class="vs">' + (r.home ? 'vs ' : 'at ') + esc(r.oppName) + '</p>';
    h += '<div class="chips">' + chips.map((c) => '<span>' + esc(c) + '</span>').join('') + '</div>' + tradeLine(r.trade);
    if (rep.home) {
      const pct = Math.round((rep.attendance / rep.capacity) * 100);
      h += '<div class="gate"><div class="gatehead"><span>Attendance</span><b>' + num(rep.attendance) + ' / ' + num(rep.capacity) + (rep.sellout ? ' <i class="stamp">Sellout</i>' : '') + '</b></div><i class="meter"><i style="width:' + pct + '%"></i></i>' + (rep.visitors ? '<p class="fine">' + num(rep.visitors) + ' of them were visiting fans in seats your crowd left empty.</p>' : '') +
        (rep.limiter === 'access' ? '<p class="fine">' + num(rep.demand - rep.attendance) + ' more fans wanted in but could not get there. Build or upgrade a Transit Hub.</p>' : rep.limiter === 'capacity' ? '<p class="fine">' + num(rep.demand - rep.attendance) + ' fans were turned away at a full house. Expand the stadium or raise prices.</p>' : '') + '</div>';
    }
    h += '<table class="lines"><tbody>' + rep.lines.map((l) => '<tr><td><b>' + esc(l.label) + '</b><span>' + esc(l.note) + '</span></td><td class="' + (l.amount < 0 ? 'bad' : '') + '">' + money(l.amount) + '</td></tr>').join('') +
      '</tbody><tfoot><tr><td><b>Net for the week</b></td><td class="' + (rep.net < 0 ? 'bad' : 'good') + '">' + money(rep.net) + '</td></tr></tfoot></table>';
    const dh = rep.hype[1] - rep.hype[0], df = rep.fans[1] - rep.fans[0];
    h += '<div class="deltas"><div><span>Hype</span><b class="' + (dh >= 0 ? 'good' : 'bad') + '">' + Math.round(rep.hype[0]) + ' → ' + Math.round(rep.hype[1]) + '</b><ul>' + rep.hypeLines.map((x) => '<li><em class="' + (x.d >= 0 ? 'good' : 'bad') + '">' + (x.d >= 0 ? '+' : '') + x.d.toFixed(1) + '</em> ' + esc(x.label) + '</li>').join('') + '</ul></div>' +
      '<div><span>Fanbase</span><b class="' + (df >= 0 ? 'good' : 'bad') + '">' + (df >= 0 ? '+' : '') + num(df) + '</b><ul><li>Now ' + num(rep.fans[1]) + ' fans</li></ul></div></div>';
    const myCut = LG && LG.view.cut[r.week] && LG.view.cut[r.week][S.rid];
    if (myCut) h += '<div class="won"><p><b>' + num(myCut.visitors) + ' visiting fans</b> from ' + esc(FT.teamName(L, myCut.from)) + ' got seats. Your bonus for this matchup is cut by <em>' + Math.round(myCut.pct * 100) + '%</em>.</p></div>';
    const tb = LG && LG.view.bonus[r.week], row = tb && tb.rows.find((x) => x.rid === S.rid);
    if (row) h += '<div class="won"><p><b>Owner edge ' + (row.edge >= 0 ? '+' : '') + row.edge.toFixed(1) + '%</b> against your auto-pilot, ' + (tb.rows.indexOf(row) + 1) + ' of ' + tb.rows.length + ' in the league. <em>+' + row.bonus.toFixed(1) + ' bonus points</em> for Week ' + (r.week + 1) + '.</p></div>';
    if (rep.badges.length) h += '<div class="won">' + rep.badges.map((b) => '<p><b>Milestone: ' + esc(b.name) + '</b> <em>+' + money(b.reward) + '</em></p>').join('') + '</div>';
    return h + '<button class="btn primary big" data-act="close">Back to the district</button>';
  }
  function openReport(rep) {
    $('#modal-body').innerHTML = reportHTML(rep);
    $('#modal').hidden = false;
    $('#modal-body').scrollTop = 0;
    const btn = $('#modal-body .btn'); if (btn) btn.focus({ preventScroll: true });
  }

  function render() {
    if (!S) return;
    hud();
    document.documentElement.style.setProperty('--team', S.color);
    document.querySelectorAll('.tabs button').forEach((b) => { const on = b.dataset.v === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    if ((tab === 'bonus' && !LG) || (tab === 'admin' && !(LG && LG.view.admin))) tab = 'game';
    $('#tab-bonus').hidden = !LG; $('#tab-admin').hidden = !(LG && LG.view.admin);
    $('#btn-switch').hidden = $('#btn-reset').hidden = !!LG; $('#btn-leave').hidden = !LG;
    $('#panel').innerHTML = tab === 'game' ? viewGame() : tab === 'build' ? viewBuild() : tab === 'league' ? viewLeague() : tab === 'bonus' ? viewBonus() : tab === 'admin' ? viewAdmin() : viewLedger();
    const away = visitBanner();
    renderer.state = away || S; renderer.selected = away ? null : selected;
    // the town shows the kickoff time of the game on screen: the report's game while it is open, otherwise the next one
    const upcoming = LG ? { status: 'ready', result: FT.matchup(L, LG.view.week, S.rid) } : FT.nextWeek(S, L), shown = !$('#modal').hidden && S.history.length ? S.history[S.history.length - 1].r : upcoming.status === 'ready' ? upcoming.result : S.history.length ? S.history[S.history.length - 1].r : null;
    renderer.night = !!(shown && shown.night);
    $('.board').classList.toggle('day', !renderer.night);
    const last = S.history[S.history.length - 1];
    if (last && !last.r.bye) renderer.score = Math.round(last.r.pts) + '-' + Math.round(last.r.oppPts);
    const lastHome = S.history.slice().reverse().find((x) => x.home);
    if (away) renderer.score = null; // the visitor's own scoreline does not belong on someone else's board
    renderer.fill = away ? away.fill : lastHome ? lastHome.attendance / lastHome.capacity : Math.min(1, FT.forecast(S).attendance / FT.forecast(S).capacity);
  }

  function showGame() {
    $('#setup').hidden = true; $('#game').hidden = false;
    if (!renderer) {
      const cv = $('#city');
      renderer = new FT.Renderer(cv);
      renderer.start();
      const pick = (e) => { const b = cv.getBoundingClientRect(); return renderer.pick(e.clientX - b.left, e.clientY - b.top); };
      // drag to pan (mouse always; touch only once zoomed in, so the page still scrolls), wheel to zoom, click to select
      let drag = null, moved = false;
      const canDrag = (e) => e.pointerType === 'mouse' || renderer.zoom > 1.05;
      cv.addEventListener('pointerdown', (e) => { moved = false; if (canDrag(e)) { drag = { x: e.clientX, y: e.clientY }; try { cv.setPointerCapture(e.pointerId); } catch (err) { /* capture is optional */ } } });
      cv.addEventListener('pointermove', (e) => {
        if (drag) {
          const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
          if (moved || Math.abs(dx) + Math.abs(dy) > 5) { moved = true; renderer.panBy(dx, dy); drag = { x: e.clientX, y: e.clientY }; cv.style.cursor = 'grabbing'; return; }
        }
        renderer.hover = visiting != null ? null : pick(e); cv.style.cursor = renderer.hover ? 'pointer' : 'grab';
      });
      const endDrag = () => { drag = null; };
      cv.addEventListener('pointerup', endDrag); cv.addEventListener('pointercancel', endDrag);
      cv.addEventListener('pointerleave', () => { renderer.hover = null; });
      cv.addEventListener('click', (e) => { if (moved) { moved = false; return; } if (visiting != null) return; const k = pick(e); selected = k; setup.confirm = null; if (k) tab = 'build'; render(); });
      cv.addEventListener('wheel', (e) => {
        if (document.documentElement.scrollHeight > window.innerHeight + 2) return; // stacked phone layout: let the page scroll
        e.preventDefault(); const b = cv.getBoundingClientRect();
        renderer.zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - b.left, e.clientY - b.top); syncTouch();
      }, { passive: false });
      window.addEventListener('resize', () => renderer.resize());
      if (window.ResizeObserver) new ResizeObserver(() => renderer.resize()).observe(cv);
    }
    renderer.resize();
    render();
  }
  function showSetup() { $('#game').hidden = true; $('#setup').hidden = false; setup.step = 'start'; setup.error = ''; renderSetup(); }

  // ---- league mode ---------------------------------------------------------------------
  // When the page is served by server.js and opened with an owner's link, the server holds the game.
  // S and L are then read-only copies of the server's state and every action is a request.
  const TOKEN_KEY = 'franchise-tycoon-league-token';
  let LG = null, server = null;
  async function api(pathname, body) {
    const sep = pathname.indexOf('?') >= 0 ? '&' : '?';
    const res = await fetch('api/' + pathname + sep + 't=' + encodeURIComponent(LG ? LG.token : ''), body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
    const j = await res.json().catch(() => ({ error: 'The league server sent an unreadable reply.' }));
    if (!res.ok) throw Object.assign(new Error(j.error || 'The league server refused that.'), { status: res.status });
    return j;
  }
  function applyView(v) { LG.view = v; S = v.S; L = v.league; }
  function seenKey() { return 'franchise-tycoon-seen-' + L.leagueId + '-' + S.rid; }
  function maybeReport() {
    const last = S.history[S.history.length - 1];
    if (!last) return;
    let seen = 0;
    try { seen = +localStorage.getItem(seenKey()) || 0; } catch (e) { /* no storage: show it once per visit */ }
    if (last.r.week > seen && !LG.shown) {
      LG.shown = true;
      try { localStorage.setItem(seenKey(), String(last.r.week)); } catch (e) { /* fine */ }
      openReport(last); render();
      if (last.r.win) renderer.fireworks(5);
    }
  }
  async function refresh(force) {
    try { const before = LG.view ? LG.view.week : null; applyView(await api('state' + (force ? '?sync=1' : ''))); if (before !== LG.view.week) LG.shown = false; if (force) notice = 'Up to date with the league server.'; }
    catch (e) { if (e.status === 401) return leaveLeague(e.message); notice = e.message; }
    render(); maybeReport();
  }
  async function lact(body) {
    try { applyView(await api('act', body)); notice = ''; } catch (e) { notice = e.message; }
    render();
  }
  function leaveLeague(msg) {
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* nothing stored */ }
    LG = null; S = L = null; clearInterval(leaveLeague.timer);
    if (load()) showGame(); else { showSetup(); setup.error = msg || ''; renderSetup(); }
  }
  function enterLeague(view, token) {
    LG = { token, shown: false }; applyView(view);
    try { localStorage.setItem(TOKEN_KEY, token); } catch (e) { /* link still works */ }
    setup.color = S.color; tab = view.admin && !Object.keys(view.bonus).length && !S.history.length ? 'admin' : 'game'; selected = null; notice = '';
    showGame(); maybeReport();
    clearInterval(leaveLeague.timer);
    leaveLeague.timer = setInterval(() => { if (LG && !document.hidden && $('#modal').hidden && tab !== 'admin') refresh(false); }, 60000);
  }
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const hourLabel = (h) => (h % 12 || 12) + ':00 ' + (h < 12 ? 'AM' : 'PM');
  function untilText(ts, nowTs) {
    const m = Math.max(0, Math.round((ts - nowTs) / 60000)), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
    return d ? d + 'd ' + h + 'h' : h ? h + 'h ' + (m % 60) + 'm' : m + ' min';
  }
  const payoutText = (p) => (p === 'top3' ? 'the top three owners' : p === 'half' ? 'the top half of the league' : 'everyone above last place');

  function viewGameLeague() {
    const V = LG.view, f = FT.forecast(S), m = FT.matchup(L, V.week, S.rid);
    let h = '';
    if (V.phase === 'done') return '<div class="card match"><div class="kicker">' + esc(L.season) + ' season</div><h2>Season complete</h2><p>The final bonus table is on the Bonus tab.</p></div>';
    if (!m) return '<div class="card match"><div class="kicker">Week ' + V.week + '</div><h2>Schedule pending</h2><p>Sleeper has not posted this week\'s matchups yet. You can still build.</p></div>';
    const kind = m.bye ? 'Bye week' : m.home ? 'Home game' : 'Away game';
    h += '<div class="card match"><div class="kicker">Week ' + V.week + (m.playoff ? ' · Playoffs' : '') + ' · ' + kind + (m.bye ? '' : m.night ? ' · Night' : ' · Afternoon') + '</div>' +
      '<h2>' + (m.bye ? 'No opponent this week' : (m.home ? 'vs ' : 'at ') + esc(m.oppName)) + '</h2>';
    if (V.phase === 'open') {
      h += '<p>' + (V.lockAt ? 'Decisions lock <b>' + new Date(V.lockAt).toLocaleString([], { weekday: 'long', hour: 'numeric', minute: '2-digit' }) + '</b>, in ' + untilText(V.lockAt, V.now) + '.' : 'Decisions lock when the commissioner kicks off the demo week.') +
        ' Everything you build or set before then counts for this week.</p>' +
        tradeLine(FT.tradeImpact(L, V.week, S.rid)) + travelLine(V.travel) +
        (m.night && !m.bye ? '<p class="linkline">Prime-time night game: broadcast rights pay +25%' + (m.home ? ' and concessions +10%.' : '.') + '</p>' : '') + '</div>';
      if (m.home) h += crowdCard(f);
      if (!m.bye) h += promoCard(m);
      h += miniList();
      h += '<p class="fine notice">Saved to the league server as you go. There is nothing to submit.</p>';
    } else {
      h += '<div class="live"><div><span>' + esc(S.name) + '</span><b>' + m.pts.toFixed(1) + '</b></div><div><span>' + esc(m.oppName) + '</span><b>' + (m.bye ? '-' : m.oppPts.toFixed(1)) + '</b></div></div>' +
        '<p><b>Locked in.</b> ' + (m.home ? FT.PRICES[S.price].name + ' tickets, ' : '') + FT.PROMOS[S.promo || 'none'].name.toLowerCase() + '. The week settles for every owner at once when Sleeper finalizes the scores, usually Tuesday morning.</p></div>';
    }
    if (notice) h += '<p class="fine notice" role="status">' + esc(notice) + '</p>';
    return h;
  }

  function bonusText(w, tb) {
    return 'Franchise Tycoon bonus points, earned in Week ' + w + ', added to Week ' + (w + 1) + ' scores\n' +
      tb.rows.map((r, i) => (i + 1) + '. ' + FT.teamName(L, r.rid) + ': +' + r.bonus.toFixed(1)).join('\n');
  }
  function viewBonus() {
    const V = LG.view, weeks = Object.keys(V.bonus).map(Number).sort((a, b) => a - b);
    let h = '<div class="card"><h3>How bonus points work</h3><p class="fine">Each week your franchise is compared with an auto-pilot owner who had your exact fantasy result. Your <b>edge</b> is how much more (or less) you earned than that auto-pilot, so it measures your decisions and not your fantasy score. The best edge earns <b>' + V.cap + '</b> points, sliding down across ' + payoutText(V.settings.payout) + '.' + (V.settings.travelCut ? ' When you host, visiting fans who get seats can cut the bonus you use that week by up to ' + Math.round(V.settings.travelCut * 100) + '%.' : '') + ' The commissioner adds them to next week\'s score in Sleeper.</p></div>';
    if (!weeks.length) return h + '<div class="card"><h3>No table yet</h3><p>The first bonus table posts when Week ' + V.week + ' settles.</p></div>';
    const w = weeks.indexOf(LG.bonusWeek) >= 0 ? LG.bonusWeek : weeks[weeks.length - 1], tb = V.bonus[w], i = weeks.indexOf(w);
    h += '<div class="card"><div class="weeknav"><button class="btn ghost small" data-act="bonusweek" data-v="' + weeks[i - 1] + '"' + (i > 0 ? '' : ' disabled') + ' aria-label="Earlier week">‹</button><h3>Earned in Week ' + w + ' · applies to Week ' + (w + 1) + '</h3><button class="btn ghost small" data-act="bonusweek" data-v="' + weeks[i + 1] + '"' + (i < weeks.length - 1 ? '' : ' disabled') + ' aria-label="Later week">›</button></div>' +
      (tb.paid ? '' : '<p class="pill">No bonuses this week: the league does not award them in the playoffs</p>') +
      '<div class="scroll"><table><thead><tr><th>#</th><th>Owner</th><th>Net</th><th>Auto-pilot</th><th>Edge</th><th>Bonus</th></tr></thead><tbody>' +
      tb.rows.map((r, n) => '<tr class="' + (r.rid === S.rid ? 'me' : '') + '"><td>' + (n + 1) + '</td><td>' + esc(FT.teamName(L, r.rid)) + '</td><td>' + money(r.net) + '</td><td>' + money(r.twinNet) + '</td><td class="' + (r.edge >= 0 ? 'good' : 'bad') + '">' + (r.edge >= 0 ? '+' : '') + r.edge.toFixed(1) + '%</td><td><b>+' + r.bonus.toFixed(1) + '</b></td></tr>').join('') +
      '</tbody></table></div><button class="btn ghost wide" data-act="copy" data-v="' + esc(bonusText(w, tb)) + '">Copy table for the league chat</button></div>';
    // next week's matchups with the bonus applied, for the commissioner to enter
    const wk = L.weeks[w + 1], bonusOf = {}, cuts = V.cut[w + 1], cutNote = {};
    tb.rows.forEach((r) => {
      const c = cuts && cuts[r.rid];
      bonusOf[r.rid] = c ? Math.round(r.bonus * (1 - c.pct) * 10) / 10 : r.bonus;
      if (c && r.bonus) cutNote[r.rid] = ' (' + r.bonus.toFixed(1) + ' less ' + Math.round(c.pct * 100) + '% for visiting fans)';
    });
    if (wk) {
      const seen = {}, rows = [];
      Object.keys(wk.teams).map(Number).forEach((a) => {
        const b = FT.opponentOf(wk, a);
        if (b == null || seen[a] || seen[b]) return;
        seen[a] = seen[b] = 1;
        const ra = wk.teams[a].pts, rb = wk.teams[b].pts, aa = ra + (bonusOf[a] || 0), ab = rb + (bonusOf[b] || 0);
        const flip = wk.complete && Math.sign(ra - rb) !== Math.sign(aa - ab);
        rows.push('<div class="adj' + (flip ? ' flip' : '') + '"><div><span>' + esc(FT.teamName(L, a)) + '</span><b>' + aa.toFixed(2) + '</b><em>' + ra.toFixed(2) + ' + ' + (bonusOf[a] || 0).toFixed(1) + (cutNote[a] || '') + '</em></div><div><span>' + esc(FT.teamName(L, b)) + '</span><b>' + ab.toFixed(2) + '</b><em>' + rb.toFixed(2) + ' + ' + (bonusOf[b] || 0).toFixed(1) + (cutNote[b] || '') + '</em></div>' + (flip ? '<p>The bonus changes the winner of this matchup.</p>' : '') + '</div>');
      });
      h += '<div class="card"><h3>Week ' + (w + 1) + ' scores with bonuses · ' + (wk.complete ? 'Final' : 'In progress') + '</h3>' + rows.join('') + '<p class="fine">Raw Sleeper score plus bonus. ' + (cuts ? 'Visiting-fan cuts are final.' : 'Visiting fans can still cut a home owner\'s bonus: that is decided when Week ' + (w + 1) + ' settles, so enter these after it does.') + ' The sim itself always runs on the raw scores.</p>' +
        (cuts ? '<button class="btn ghost wide" data-act="copy" data-v="' + esc('Week ' + (w + 1) + ' bonus points to add in Sleeper\n' + tb.rows.map((r) => FT.teamName(L, r.rid) + ': +' + (bonusOf[r.rid] || 0).toFixed(1)).join('\n')) + '">Copy final adjustments</button>' : '') + '</div>';
    }
    return h;
  }

  function settingsForm(s, teams) {
    const opt = (v, label, cur) => '<option value="' + v + '"' + (String(v) === String(cur) ? ' selected' : '') + '>' + label + '</option>';
    const weeksOpt = (lo, hi, cur) => { let o = ''; for (let w = lo; w <= hi; w++) o += opt(w, 'Week ' + w, cur); return o; };
    let hours = ''; for (let i = 0; i < 24; i++) hours += opt(i, hourLabel(i) + ' ET', s.lockHour);
    return '<div class="field"><label for="set-cap">Maximum bonus points per week</label><div class="slider"><input type="range" id="set-cap" min="0" max="15" step="0.5" value="' + s.cap + '"><output id="set-cap-out" for="set-cap">' + (+s.cap).toFixed(1) + '</output></div><p class="fine">Set to 0 to run the sim with no effect on fantasy scores.</p></div>' +
      '<div class="field"><label for="set-cut">Most a visiting crowd can cut the home owner\'s bonus</label><div class="slider"><input type="range" id="set-cut" min="0" max="75" step="5" value="' + Math.round((s.travelCut == null ? 0.5 : s.travelCut) * 100) + '"><output id="set-cut-out" for="set-cut">' + Math.round((s.travelCut == null ? 0.5 : s.travelCut) * 100) + '%</output></div><p class="fine">Away fans who get seats reduce the bonus the home owner uses in that matchup. Set to 0 to turn this off.</p></div>' +
      '<div class="field"><label for="set-payout">Who earns bonus points</label><select id="set-payout">' + opt('all', 'Sliding scale: everyone above last place', s.payout) + opt('half', 'Sliding scale: top half only', s.payout) + opt('top3', 'Sliding scale: top three only', s.payout) + '</select></div>' +
      '<div class="pair"><div class="field"><label for="set-pstart">Playoffs start</label><select id="set-pstart">' + weeksOpt(10, 18, s.playoffStart) + '</select></div>' +
      '<div class="field"><label for="set-last">Last week of the season</label><select id="set-last">' + weeksOpt(12, 18, s.lastWeek) + '</select></div></div>' +
      '<label class="check"><input type="checkbox" id="set-mini"' + (s.miniBoost === false ? '' : ' checked') + '> Mini-game medals boost buildings (scores come from each owner\'s own browser)</label>' +
      '<label class="check"><input type="checkbox" id="set-pbonus"' + (s.playoffBonus ? ' checked' : '') + '> Award bonus points during the playoffs</label>' +
      '<div class="pair"><div class="field"><label for="set-lday">Decisions lock on</label><select id="set-lday">' + DAYS.map((d, i) => opt(i, d, s.lockDay)).join('') + '</select></div>' +
      '<div class="field"><label for="set-lhour">At</label><select id="set-lhour">' + hours + '</select></div></div>' +
      (teams != null ? '<p class="fine">Teams: <b>' + teams + '</b>, read from Sleeper. Playoff and season weeks start from what Sleeper reports; change them here if your league differs.</p>' : '');
  }
  function readSettings() {
    return { cap: +$('#set-cap').value, travelCut: +$('#set-cut').value / 100, payout: $('#set-payout').value, playoffStart: +$('#set-pstart').value, lastWeek: +$('#set-last').value, miniBoost: $('#set-mini').checked, playoffBonus: $('#set-pbonus').checked, lockDay: +$('#set-lday').value, lockHour: +$('#set-lhour').value };
  }
  function viewAdmin() {
    const V = LG.view, base = location.origin + location.pathname + '#';
    let h = '<div class="card"><div class="kicker">Commissioner</div><h2>League settings</h2>' + settingsForm(V.settings, L.teams.length) +
      '<button class="btn primary wide" data-act="savesettings">Save settings</button><p class="fine">Changes apply from the next table. Tables already posted keep the rules they were scored under. League mode began in Week ' + V.startWeek + '.</p>' +
      (notice ? '<p class="fine notice" role="status">' + esc(notice) + '</p>' : '') + '</div>';
    h += '<div class="card"><h3>Owner links</h3><p class="fine">Send each owner their own link privately. A link is that owner\'s login, so anyone holding it can run that franchise.</p><div class="invites">' +
      V.invites.map((v) => '<div class="invite"><label for="inv-' + v.rid + '">' + esc(v.name) + (v.admin ? ' (you, commissioner)' : '') + '</label><div class="row"><input id="inv-' + v.rid + '" readonly value="' + esc(base + v.token) + '"><button class="btn ghost small" data-act="copy" data-v="' + esc(base + v.token) + '">Copy</button></div></div>').join('') + '</div></div>';
    if (V.demo) h += '<div class="card"><h3>Demo league clock</h3><p class="fine">A demo league has no real schedule, so you move time by hand.</p>' +
      (V.phase === 'open' ? '<button class="btn ghost wide" data-act="demolock">Kick off Week ' + V.week + ' (lock decisions)</button>' : '') +
      (V.phase !== 'done' ? '<button class="btn ghost wide" data-act="demofinish">Finish Week ' + V.week + ' and settle</button>' : '') + '</div>';
    return h;
  }

  function syncTouch() { $('#city').style.touchAction = renderer.zoom > 1.05 ? 'none' : 'manipulation'; }

  // ---- actions --------------------------------------------------------------------------
  const ACT = {
    color(v) { setup.color = v; renderSetup(); },
    demo() { begin(FT.demoLeague(2026, 9), null); },
    league(v) { chooseLeague(v); },
    back() { setup.step = setup.step === 'team' || setup.step === 'lgconfirm' ? 'leagues' : setup.step === 'leagues' && setup.forLeague ? 'lguser' : 'start'; if (setup.step === 'start') setup.forLeague = false; setup.error = ''; renderSetup(); },
    begin() { setup.league.myRosterId = +$('#team').value; begin(setup.league, setup.conn); },
    tab(v) { tab = v; if (v === 'build' || v === 'game') visiting = null; render(); },
    visit(v) { visiting = +v; selected = null; renderer.resetView(); render(); },
    visitstep(v) { const rows = boardRows().filter((x) => !x.me), i = rows.findIndex((x) => x.rid === visiting); visiting = rows[(i + +v + rows.length) % rows.length].rid; render(); },
    gohome() { visiting = null; render(); },
    price(v) { if (LG) return lact({ a: 'price', v: +v }); S.price = +v; save(); render(); },
    promo(v) { if (LG) return lact({ a: 'promo', v }); S.promo = v; save(); render(); },
    play() {
      const rep = FT.playWeek(S, L);
      if (!rep) return;
      notice = ''; save(); openReport(rep); render();
      renderer.gameDay = true; setTimeout(() => (renderer.gameDay = false), 9000);
      if (rep.r.win) renderer.fireworks(rep.r.playoff ? 9 : 5);
    },
    close() { $('#modal').hidden = true; render(); },
    report(v) { openReport(S.history[+v]); },
    build(v) { if (LG) return lact({ a: 'build', k: selected, type: v }); if (FT.build(S, selected, v)) { save(); render(); } },
    upgrade() { if (LG) return lact({ a: 'upgrade', k: selected }); if (FT.upgrade(S, selected)) { save(); render(); } },
    stadium() { if (LG) return lact({ a: 'stadium' }); if (FT.upgradeStadium(S)) { save(); render(); } },
    demolish() { if (setup.confirm === selected) { setup.confirm = null; if (LG) return lact({ a: 'demolish', k: selected }); FT.demolish(S, selected); save(); } else setup.confirm = selected; render(); },
    skip() { FT.setDemoWeek(L, L.demoThrough + 1); save(); render(); },
    newseason() { const seed = (L.seed || 2026) + 1; const nl = FT.demoLeague(seed, 3); nl.season = String(+L.season + 1); L = nl; S.wins = S.losses = 0; S.streak = 0; save(); render(); },
    mini(v) { playMini(v); },
    sync() { if (LG) return refresh(true); sync(); },
    bonusweek(v) { LG.bonusWeek = +v; render(); },
    savesettings() { lact({ a: 'settings', v: readSettings() }).then(() => { if (!notice) { notice = 'Settings saved.'; render(); } }); },
    demolock() { lact({ a: 'demoLock' }); },
    demofinish() { LG.shown = false; lact({ a: 'demoFinish' }).then(maybeReport); },
    leave() { $('#menu').hidden = true; leaveLeague(); },
    copy(v, el) {
      const done = () => { const t = el.textContent; el.textContent = 'Copied'; setTimeout(() => (el.textContent = t), 1400); };
      const fallback = () => { const inp = el.parentElement.querySelector('input'); if (inp) { inp.focus(); inp.select(); } };
      try { navigator.clipboard.writeText(v).then(done, fallback); } catch (e) { fallback(); }
    },
    lgstart() { setup.forLeague = true; setup.step = 'lguser'; setup.error = ''; renderSetup(); },
    lgdemo() { createLeague({ demo: true, cap: 5 }); },
    lgcreate() { createLeague({ leagueId: setup.conn.leagueId, userId: setup.conn.userId, cap: +$('#set-cap').value, key: ($('#lg-key') || {}).value || '' }, readSettings()); },
    zoomin() { renderer.zoomBy(1.3); syncTouch(); },
    zoomout() { renderer.zoomBy(1 / 1.3); syncTouch(); },
    zoomreset() { renderer.resetView(); syncTouch(); },
    menu() { const m = $('#menu'); m.hidden = !m.hidden; setup.wipe = false; $('#menu [data-act="reset"]').textContent = 'Start over'; },
    switchleague() { $('#menu').hidden = true; if (conn && conn.username) setup.username = conn.username; setup.keep = true; showSetup(); },
    reset() { if (!setup.wipe) { setup.wipe = true; $('#menu [data-act="reset"]').textContent = 'Tap again to erase the franchise'; return; } $('#menu').hidden = true; setup.wipe = false; setup.keep = false; wipe(); showSetup(); },
  };
  // Switching league keeps the franchise: only the league data underneath it changes.
  const beginFresh = begin;
  begin = function (league, connection) {
    if (setup.keep && S) {
      setup.keep = false;
      const old = S; L = league; conn = connection;
      S.rid = L.myRosterId; S.color = setup.color || S.color;
      const rivals = {};
      L.teams.forEach((t, i) => { if (t.rosterId !== S.rid) rivals[t.rosterId] = old.rivals[t.rosterId] || Object.values(old.rivals)[i] || FT.newFranchise(t.rosterId); });
      Object.keys(rivals).forEach((id) => (rivals[id].rid = +id));
      S.rivals = rivals; S.name = FT.teamName(L, S.rid);
      tab = 'game'; selected = null; notice = ''; save(); showGame();
      if (L.source === 'sleeper') fetchNames();
      return;
    }
    beginFresh(league, connection);
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) { if (!e.target.closest('#menu')) $('#menu').hidden = true; return; }
    if (el.dataset.act !== 'menu' && el.dataset.act !== 'reset') $('#menu').hidden = true;
    ACT[el.dataset.act](el.dataset.v, el);
  });
  document.addEventListener('input', (e) => { if (e.target.id === 'set-cap') $('#set-cap-out').textContent = (+e.target.value).toFixed(1); if (e.target.id === 'set-cut') $('#set-cut-out').textContent = e.target.value + '%'; });
  document.addEventListener('submit', (e) => { if (e.target.id === 'connect') { e.preventDefault(); const u = $('#username').value.trim(); if (u) connect(u); } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('#modal').hidden = true; $('#menu').hidden = true; } });
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') $('#modal').hidden = true; });

  async function boot() {
    const hash = location.hash.slice(1);
    let tok = /^[\w-]{20,40}$/.test(hash) ? hash : null;
    try { if (!tok) tok = localStorage.getItem(TOKEN_KEY); } catch (e) { /* no storage */ }
    if (/^https?:$/.test(location.protocol)) {
      try { const r = await fetch('api/ping'); const j = r.ok ? await r.json() : null; if (j && j.ok) server = j; } catch (e) { /* not served by a league server: solo play only */ }
    }
    if (server && tok) {
      LG = { token: tok };
      try {
        const view = await api('state');
        if (hash) history.replaceState(null, '', location.pathname);
        return enterLeague(view, tok);
      } catch (e) { LG = null; if (e.status === 401) { try { localStorage.removeItem(TOKEN_KEY); } catch (err) { /* nothing stored */ } setup.error = e.message; } }
    }
    if (load()) { setup.color = S.color; showGame(); if (L.source === 'sleeper') sync(); } else { const err = setup.error; showSetup(); if (err) { setup.error = err; renderSetup(); } }
  }
  boot();
  window.FTApp = { get state() { return S; }, get league() { return L; }, get renderer() { return renderer; } };
})();
