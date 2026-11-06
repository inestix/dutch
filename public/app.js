/* Client du Dutch en ligne */
const socket = io();
const $ = (id) => document.getElementById(id);
const TOKEN_KEY = 'dutch-token';
const PEEK_MS = 4000;
const FLASH_MS = 2500;

let S = null;            // dernier état reçu
let fastMode = false;    // défausse rapide armée
let sel = [];            // cibles sélectionnées (Valet / Roi noir)
const peeks = new Map(); // "pid:slot" -> { card, until }
const flashes = new Map();
let hlUntil = 0, hlSeq = 0;

const store = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch {} },
  del(k) { try { sessionStorage.removeItem(k); } catch {} },
  lget(k) { try { return localStorage.getItem(k); } catch { return null; } },
  lset(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

/* ---------- Accueil ---------- */
$('name').value = store.lget('dutch-name') || '';
const urlCode = new URLSearchParams(location.search).get('code');
if (urlCode) $('code').value = urlCode.toUpperCase();

function getName() {
  const n = $('name').value.trim();
  if (!n) { $('home-error').textContent = 'Choisis un pseudo'; $('name').focus(); return null; }
  store.lset('dutch-name', n);
  return n;
}
function onJoined(res, errEl) {
  if (res.error) { errEl.textContent = res.error; return; }
  store.set(TOKEN_KEY, res.token);
  history.replaceState(null, '', location.pathname);
}
$('btn-create').onclick = () => {
  const name = getName(); if (!name) return;
  socket.emit('create', { name }, (r) => onJoined(r, $('home-error')));
};
$('btn-join').onclick = () => {
  const name = getName(); if (!name) return;
  const code = $('code').value.trim().toUpperCase();
  if (!code) { $('home-error').textContent = 'Entre le code du salon'; return; }
  socket.emit('join', { name, code }, (r) => onJoined(r, $('home-error')));
};
$('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-join').click(); });

/* ---------- Salon ---------- */
$('lobby-code').onclick = () => {
  const link = `${location.origin}${location.pathname}?code=${S.code}`;
  navigator.clipboard?.writeText(link).then(() => toast('Lien copié !'), () => toast(link));
};
$('btn-start').onclick = () => socket.emit('start', null, (r) => r.error && ($('lobby-error').textContent = r.error));
$('btn-leave').onclick = () => { socket.emit('leave'); store.del(TOKEN_KEY); S = null; show('home'); };

/* ---------- Connexion ---------- */
socket.on('connect', () => {
  const token = store.get(TOKEN_KEY);
  if (token) socket.emit('resume', { token }, (r) => { if (r.error) { store.del(TOKEN_KEY); show('home'); } });
});
socket.on('state', (s) => {
  const prevPhase = S?.game?.phase;
  S = s;
  const g = s.game;
  if (!g || g.phase !== 'play') { fastMode = false; sel = []; }
  if (g && prevPhase !== g.phase && g.phase === 'peek') { peeks.clear(); flashes.clear(); }
  if (g && g.step !== 'power') sel = [];
  if (g?.highlight && g.highlight.seq !== hlSeq) {
    hlSeq = g.highlight.seq;
    hlUntil = Date.now() + 1400;
    setTimeout(render, 1450);
  }
  render();
});
socket.on('peek', ({ cards }) => {
  const until = Date.now() + PEEK_MS;
  for (const c of cards) peeks.set(`${c.pid}:${c.slot}`, { card: c.card, until });
  render();
  setTimeout(render, PEEK_MS + 50);
});
socket.on('flash', ({ pid, slot, card }) => {
  flashes.set(`${pid}:${slot}`, { card, until: Date.now() + FLASH_MS });
  render();
  setTimeout(render, FLASH_MS + 50);
});

function act(a) {
  socket.emit('action', a, (r) => { if (r?.error) toast(r.error); });
}

/* ---------- Rendu ---------- */
function show(id) {
  for (const s of ['home', 'lobby', 'table']) $(s).classList.toggle('hidden', s !== id);
}

function render() {
  if (!S) return show('home');
  if (!S.game) return renderLobby();
  show('table');
  renderTable();
}

function renderLobby() {
  show('lobby');
  $('lobby-code').textContent = S.code;
  $('lobby-players').innerHTML = S.lobby.map((p) => `
    <li><span>${esc(p.name)}${p.id === S.me ? ' (toi)' : ''}</span>
    <span>${p.id === S.hostId ? '<span class="badge gold">Hôte</span>' : ''}
    ${p.connected ? '' : '<span class="badge off">Déconnecté</span>'}</span></li>`).join('');
  const n = S.lobby.filter((p) => p.connected).length;
  const isHost = S.hostId === S.me;
  $('btn-start').classList.toggle('hidden', !isHost);
  $('btn-start').disabled = n < S.minPlayers;
  $('lobby-info').textContent = n < S.minPlayers
    ? `En attente de joueurs (${n}/${S.minPlayers} minimum, ${S.maxPlayers} max)`
    : isHost ? `${n} joueurs, tu peux lancer la partie !` : `En attente que l'hôte lance la partie…`;
}

function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function cardFace(c, extra = '') {
  if (c.rank === 'JK') return `<div class="card joker ${extra}"><span class="rk">★</span><span class="st">🃏</span>${c.value !== undefined ? `<span class="val">${c.value}</span>` : ''}</div>`;
  const red = c.suit === '♥' || c.suit === '♦';
  const rk = { J: 'V', Q: 'D', K: 'R' }[c.rank] || c.rank;
  return `<div class="card ${red ? 'red' : ''} ${extra}"><span class="rk">${rk}</span><span class="st">${c.suit}</span>${c.value !== undefined ? `<span class="val">${c.value}</span>` : ''}</div>`;
}

// Placement : 0 1 en haut, 2 3 en bas, cartes supplémentaires à droite
function slotPos(i) {
  if (i < 4) return { col: (i % 2) + 1, row: Math.floor(i / 2) + 1 };
  return { col: 3 + Math.floor((i - 4) / 2), row: ((i - 4) % 2) + 1 };
}

function isSelectable(pid, slot) {
  const g = S.game;
  if (g.phase !== 'play') return false;
  if (fastMode) return true;
  const myTurn = g.turn === S.me;
  if (!myTurn) return false;
  if (g.step === 'drawn') return pid === S.me;
  if (g.step === 'power') {
    if (g.pending === '7') return pid === S.me;
    if (g.pending === '10') return pid !== S.me;
    if (g.pending === 'J' || g.pending === 'K') return true;
  }
  return false;
}

function renderHand(p, interactive = true) {
  const g = S.game;
  const now = Date.now();
  return `<div class="hand">${p.hand.map((c, i) => {
    const { col, row } = slotPos(i);
    const key = `${p.id}:${i}`;
    const style = `style="grid-column:${col};grid-row:${row}"`;
    if (c === null) return `<div class="card empty" ${style}></div>`;
    const cls = [];
    const hl = now < hlUntil && g.highlight?.slots?.some((t) => t.pid === p.id && t.slot === i);
    if (hl) cls.push('hl');
    if (interactive && isSelectable(p.id, i)) cls.push('selectable');
    if (sel.some((t) => t.pid === p.id && t.slot === i)) cls.push('selected');
    const data = interactive ? `data-pid="${p.id}" data-slot="${i}"` : '';
    let face = null;
    if (!c.hidden) face = c;
    const fl = flashes.get(key);
    const pk = peeks.get(key);
    if (!face && fl && fl.until > now) { face = fl.card; cls.push('flash'); }
    else if (!face && pk && pk.until > now) { face = pk.card; cls.push('peek'); }
    else if (!face && g.peekNow && p.id === S.me) {
      const ip = g.peekNow.find((x) => x.slot === i);
      if (ip) { face = ip.card; cls.push('peek'); }
    }
    const html = face ? cardFace(face, cls.join(' ')) : `<div class="card back ${cls.join(' ')}"></div>`;
    return html.replace('<div class="card', `<div ${style} ${data} class="card`);
  }).join('')}</div>`;
}

function seatHtml(p, mine) {
  const g = S.game;
  const lp = S.lobby.find((x) => x.id === p.id);
  const off = lp && !lp.connected;
  const badges = [
    p.id === g.dutchBy ? '<span class="badge red">DUTCH</span>' : '',
    p.id === S.hostId ? '<span class="badge">hôte</span>' : '',
    off ? '<span class="badge off">hors ligne</span>' : '',
    g.phase === 'peek' && p.ready ? '<span class="badge">prêt</span>' : '',
  ].join('');
  return `<div class="seat ${mine ? 'mine' : ''} ${g.turn === p.id && g.phase === 'play' ? 'turn' : ''} ${off ? 'offline' : ''}">
    <div class="seat-head"><span class="nm">${esc(p.name)}${mine ? ' (toi)' : ''}</span><span class="pts">${p.total} pts</span>${badges}</div>
    ${renderHand(p)}
  </div>`;
}

const POWER_TXT = {
  '7': 'Pouvoir du 7 : clique sur une de <b>tes</b> cartes pour la regarder.',
  '10': "Pouvoir du 10 : clique sur la carte d'un <b>autre joueur</b> pour la regarder.",
  'J': 'Pouvoir du Valet : choisis <b>deux cartes</b> du jeu à échanger (sans les regarder).',
  'K': 'Pouvoir du Roi noir : choisis <b>deux cartes</b> du jeu à échanger. Tu verras celle que tu récupères.',
};

function renderTable() {
  const g = S.game;
  const me = g.players.find((p) => p.id === S.me);
  const cur = g.players.find((p) => p.id === g.turn);
  const isHost = S.hostId === S.me;
  const myTurn = g.phase === 'play' && g.turn === S.me;

  $('round-info').textContent = `Manche ${g.round} · fin à ${g.scoreLimit} pts`;

  // Adversaires dans l'ordre de jeu, en commençant après moi
  const i0 = g.players.findIndex((p) => p.id === S.me);
  const others = g.players.slice(i0 + 1).concat(g.players.slice(0, i0));
  $('opponents').innerHTML = others.map((p) => seatHtml(p, false)).join('');
  $('me-seat').innerHTML = me ? seatHtml(me, true) : '';

  // Centre
  $('deck-count').textContent = `Pioche (${g.deckCount})`;
  $('discard').innerHTML = g.discardTop ? cardFace(g.discardTop) : '<div class="card empty"></div>';
  if (g.drawn) {
    $('drawn-wrap').classList.remove('hidden');
    $('drawn').innerHTML = cardFace(g.drawn);
    $('drawn-label').textContent = 'Ta carte';
  } else if (g.someoneDrawn && g.phase === 'play') {
    $('drawn-wrap').classList.remove('hidden');
    $('drawn').innerHTML = '<div class="card back"></div>';
    $('drawn-label').textContent = `Carte de ${cur.name}`;
  } else {
    $('drawn-wrap').classList.add('hidden');
  }

  // Consigne + boutons
  let text = '', btns = [];
  const curOff = cur && !S.lobby.find((x) => x.id === cur.id)?.connected;
  if (g.phase === 'peek') {
    if (g.peekNow) {
      text = 'Mémorise tes <b>2 cartes du bas</b>, puis clique sur « J\'ai mémorisé ».';
      btns.push(['J\'ai mémorisé', 'primary', () => act({ type: 'ready' })]);
    } else {
      text = 'En attente des autres joueurs…';
      if (isHost) btns.push(['Forcer le départ', 'ghost', () => act({ type: 'force' })]);
    }
  } else if (g.phase === 'play') {
    if (fastMode) {
      text = `⚡ Clique sur une carte (la tienne ou celle d'un autre) de même valeur que la défausse.`;
      btns.push(['Annuler', 'ghost', () => { fastMode = false; render(); }]);
    } else if (myTurn && g.step === 'start') {
      text = g.dutchBy ? '<b>Dernier tour !</b> Pioche une carte.' : '<b>À toi de jouer !</b> Pioche une carte ou annonce Dutch.';
      btns.push(['Piocher', 'primary', () => act({ type: 'draw' })]);
      if (!g.dutchBy) btns.push(['Dutch !', 'danger', () => { if (confirm('Annoncer Dutch ? Si tu n\'as pas le plus petit score, tes points seront doublés.')) act({ type: 'dutch' }); }]);
    } else if (myTurn && g.step === 'drawn') {
      const pw = g.drawnPower ? ` Si tu la défausses, tu actives son pouvoir.` : '';
      text = `Clique sur une de tes cartes pour l'échanger, ou défausse la carte piochée.${pw}`;
      btns.push(['Défausser', 'primary', () => act({ type: 'discard' })]);
    } else if (myTurn && g.step === 'power') {
      text = POWER_TXT[g.pending];
      btns.push(['Passer le pouvoir', 'ghost', () => act({ type: 'skip' })]);
    } else {
      text = `Au tour de <b>${esc(cur.name)}</b>${g.someoneDrawn ? ' (a pioché)' : ''}${g.step === 'power' ? ' (utilise un pouvoir)' : ''}.`;
      if (g.dutchBy) text += ' Dutch a été annoncé !';
      if (isHost && curOff) btns.push([`Passer le tour de ${cur.name}`, 'ghost', () => act({ type: 'force' })]);
    }
  } else {
    text = 'Manche terminée.';
  }
  $('prompt-text').innerHTML = text;
  const pa = $('prompt-actions');
  pa.innerHTML = '';
  for (const [label, cls, fn] of btns) {
    const b = document.createElement('button');
    b.className = `btn ${cls}`;
    b.textContent = label;
    b.onclick = fn;
    pa.appendChild(b);
  }

  $('fast-bar').classList.toggle('hidden', g.phase !== 'play');
  $('btn-fast').classList.toggle('armed', fastMode);

  // Journal
  $('log').innerHTML = g.log.map((l) => `<p>${esc(l)}</p>`).join('');
  $('log').scrollTop = $('log').scrollHeight;

  renderOverlay();
}

function renderOverlay() {
  const g = S.game;
  const ov = $('overlay');
  if (g.phase !== 'roundEnd' && g.phase !== 'gameOver') { ov.classList.add('hidden'); return; }
  ov.classList.remove('hidden');
  const isHost = S.hostId === S.me;
  const r = g.roundResult;
  const caller = g.players.find((p) => p.id === r.dutchBy);
  const rows = [...r.rows].sort((a, b) => a.score - b.score).map((row) => {
    const p = g.players.find((x) => x.id === row.pid);
    return `<div class="res-row">
      <div class="res-top"><b>${esc(row.name)}</b>
        <span>${row.score} pts${row.doubled ? ` → <b style="color:var(--danger)">×2 = ${row.points}</b>` : ''} · total <b>${row.total}</b></span></div>
      ${renderHand(p, false)}
    </div>`;
  }).join('');
  let title, sub;
  if (g.phase === 'gameOver') {
    title = `🏆 ${g.winners.map(esc).join(' & ')} gagne${g.winners.length > 1 ? 'nt' : ''} !`;
    sub = `Quelqu'un a atteint ${g.scoreLimit} points.`;
  } else {
    title = `Fin de la manche ${g.round}`;
    sub = r.failed ? `${esc(caller.name)} a raté son Dutch : points doublés !` : `${esc(caller.name)} réussit son Dutch !`;
  }
  const btn = isHost
    ? `<button class="btn primary" id="ov-btn">${g.phase === 'gameOver' ? 'Nouvelle partie' : 'Manche suivante'}</button>`
    : `<p class="muted">En attente de l'hôte…</p>`;
  ov.innerHTML = `<div class="panel"><h2>${title}</h2><p class="muted">${sub}</p><div class="results">${rows}</div>${btn}</div>`;
  const b = $('ov-btn');
  if (b) b.onclick = () => {
    if (g.phase === 'gameOver') socket.emit('start', null, (res) => res.error && toast(res.error));
    else act({ type: 'nextRound' });
  };
}

/* ---------- Clics sur les cartes ---------- */
$('table').addEventListener('click', (e) => {
  const el = e.target.closest('.card[data-pid]');
  if (!el || !S?.game) return;
  const pid = el.dataset.pid, slot = Number(el.dataset.slot);
  if (!isSelectable(pid, slot)) return;
  const g = S.game;
  if (fastMode) {
    fastMode = false;
    act({ type: 'fast', target: { pid, slot } });
    render();
    return;
  }
  if (g.step === 'drawn') return act({ type: 'swap', slot });
  if (g.step === 'power') {
    if (g.pending === '7' || g.pending === '10') return act({ type: 'power', targets: [{ pid, slot }] });
    const idx = sel.findIndex((t) => t.pid === pid && t.slot === slot);
    if (idx >= 0) sel.splice(idx, 1); else sel.push({ pid, slot });
    if (sel.length === 2) { const targets = sel; sel = []; act({ type: 'power', targets }); }
    render();
  }
});

$('btn-fast').onclick = () => { fastMode = !fastMode; sel = []; render(); };
$('btn-log').onclick = () => $('log').classList.toggle('hidden');

let toastT;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 2600);
}

render();
