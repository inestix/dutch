/* Client du Dutch en ligne */
const socket = io();
const $ = (id) => document.getElementById(id);
const btnFast = $('btn-fast');
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
  if (g && prevPhase !== g.phase && g.phase === 'peek') { peeks.clear(); flashes.clear(); marks.clear(); }
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

// Position des symboles (x %, y %) selon la valeur, comme sur un vrai jeu de cartes
const L = 33, C = 50, R = 67;
const PIPS = {
  1: [[C, 50]],
  2: [[C, 20], [C, 80]],
  3: [[C, 20], [C, 50], [C, 80]],
  4: [[L, 20], [R, 20], [L, 80], [R, 80]],
  5: [[L, 20], [R, 20], [C, 50], [L, 80], [R, 80]],
  6: [[L, 20], [R, 20], [L, 50], [R, 50], [L, 80], [R, 80]],
  7: [[L, 20], [R, 20], [C, 35], [L, 50], [R, 50], [L, 80], [R, 80]],
  8: [[L, 20], [R, 20], [C, 35], [L, 50], [R, 50], [C, 65], [L, 80], [R, 80]],
  9: [[L, 20], [R, 20], [L, 40], [R, 40], [C, 50], [L, 60], [R, 60], [L, 80], [R, 80]],
  10: [[L, 20], [R, 20], [C, 30], [L, 40], [R, 40], [L, 60], [R, 60], [C, 70], [L, 80], [R, 80]],
};

function cardFace(c, extra = '') {
  const val = c.value !== undefined ? `<span class="val">${c.value}</span>` : '';
  if (c.rank === 'JK') {
    return `<div class="card joker ${extra}"><span class="ix">★</span><span class="star">★</span><span class="jk">JOKER</span>${val}</div>`;
  }
  const red = c.suit === '♥' || c.suit === '♦';
  const rk = { J: 'V', Q: 'D', K: 'R' }[c.rank] || c.rank;
  const ix = `<span class="ix">${rk}<small>${c.suit}</small></span><span class="ix ix2">${rk}<small>${c.suit}</small></span>`;
  if (['J', 'Q', 'K'].includes(c.rank)) {
    return `<div class="card court ${red ? 'red' : ''} ${extra}">${ix}<div class="face"><span class="big">${rk}</span><small>${c.suit}</small></div>${val}</div>`;
  }
  const n = c.rank === 'A' ? 1 : parseInt(c.rank, 10);
  const pips = PIPS[n].map(([x, y]) =>
    `<span class="pip${n === 1 ? ' ace' : ''}${y > 50 ? ' down' : ''}" style="left:${x}%;top:${y}%">${c.suit}</span>`).join('');
  return `<div class="card ${red ? 'red' : ''} ${extra}">${ix}<div class="pips">${pips}</div>${val}</div>`;
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
    const mk = interactive && marks.get(key);
    if (mk && mk.until > now) cls.push(mk.cls);
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

  // Joueurs dans l'ordre de jeu, en commençant par moi (k = 0, en bas)
  const i0 = Math.max(0, g.players.findIndex((p) => p.id === S.me));
  const ordered = g.players.slice(i0).concat(g.players.slice(0, i0));
  $('seats').innerHTML = ordered.map((p) => seatHtml(p, p.id === S.me)).join('');

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
  // Le bouton de défausse rapide reste dans la même rangée que les autres actions
  if (g.phase === 'play' && !fastMode) pa.appendChild(btnFast); else btnFast.remove();
  btnFast.classList.toggle('armed', fastMode);

  // Journal
  $('log').innerHTML = g.log.map((l) => `<p>${esc(l)}</p>`).join('');
  $('log').scrollTop = $('log').scrollHeight;

  layoutRing();
  renderOverlay();
}

/* ---------- Disposition en cercle (ordinateur) ---------- */
const desktopMQ = window.matchMedia('(min-width: 1000px)');
function layoutRing() {
  const seats = [...document.querySelectorAll('#seats .seat')];
  const center = $('center');
  if (!desktopMQ.matches) {
    for (const s of seats) { s.style.left = ''; s.style.top = ''; }
    center.style.top = '';
    return;
  }
  const ring = $('ring');
  const W = ring.clientWidth, H = ring.clientHeight;
  const n = seats.length;
  const maxW = Math.max(...seats.map((s) => s.offsetWidth));
  const maxH = Math.max(...seats.map((s) => s.offsetHeight));
  const rx = Math.max(0, W / 2 - maxW / 2 - 12);
  const ry = Math.max(0, H / 2 - maxH / 2 - 8);
  seats.forEach((s, k) => {
    const a = Math.PI / 2 + (k * 2 * Math.PI) / n; // k = 0 : en bas, puis sens horaire
    s.style.left = `${W / 2 + rx * Math.cos(a)}px`;
    s.style.top = `${H / 2 + ry * Math.sin(a)}px`;
  });
  // Centre (pioche + consignes) placé entre le joueur du haut et ma main
  const meTop = seats[0] ? seats[0].offsetTop - seats[0].offsetHeight / 2 : H;
  const topSeat = n % 2 === 0 ? seats[n / 2] : null;
  const topBottom = topSeat ? topSeat.offsetTop + topSeat.offsetHeight / 2 : 0;
  const half = center.offsetHeight / 2;
  // Jamais par-dessus ma main : on remonte le centre si la place manque
  const y = Math.min((topBottom + meTop) / 2, meTop - 10 - half);
  center.style.top = `${Math.max(half, y)}px`;
}
window.addEventListener('resize', () => S?.game && layoutRing());

/* ---------- Effets visuels (échanges, Dutch…) ---------- */
const marks = new Map(); // "pid:slot" -> { cls, until }
const nameOf = (pid) => S?.game?.players.find((p) => p.id === pid)?.name || '?';
const slotEl = (t) => document.querySelector(`#seats .card[data-pid="${t.pid}"][data-slot="${t.slot}"]`);

function markSlots(targets, cls, ms) {
  const until = Date.now() + ms;
  for (const t of targets) marks.set(`${t.pid}:${t.slot}`, { cls, until });
  render();
  setTimeout(render, ms + 50);
}

function flyCard(fromEl, toEl, delay = 0) {
  if (!fromEl || !toEl) return;
  const a = fromEl.getBoundingClientRect(), b = toEl.getBoundingClientRect();
  const c = document.createElement('div');
  c.className = 'card back flying';
  Object.assign(c.style, { left: `${a.left}px`, top: `${a.top}px`, width: `${a.width}px`, height: `${a.height}px` });
  document.body.appendChild(c);
  const anim = c.animate([
    { transform: 'translate(0,0) scale(1)' },
    { transform: `translate(${(b.left - a.left) / 2}px, ${(b.top - a.top) / 2 - 40}px) scale(1.15)`, offset: 0.5 },
    { transform: `translate(${b.left - a.left}px, ${b.top - a.top}px) scale(${b.width / a.width})` },
  ], { duration: 900, delay, easing: 'ease-in-out', fill: 'forwards' });
  anim.onfinish = () => c.remove();
}

let bannerT;
function banner(html, cls = '') {
  const b = $('banner');
  b.innerHTML = html;
  b.className = `show ${cls}`;
  clearTimeout(bannerT);
  bannerT = setTimeout(() => (b.className = ''), 4500);
}

const who = (pid) => (pid === S.me ? 'Tu' : `<b>${esc(nameOf(pid))}</b>`);
function cardOf(t, by) {
  if (t.pid === S.me) return '<b>ta carte</b>';
  if (t.pid === by) return 'sa carte';
  return `la carte de <b>${esc(nameOf(t.pid))}</b>`;
}

socket.on('fx', (fx) => {
  if (!S?.game) return;
  const me = fx.by === S.me;
  if (fx.kind === 'swap') {
    const verb = me ? 'as échangé' : 'a échangé';
    banner(`🔄 ${who(fx.by)} ${verb} ${cardOf(fx.a, fx.by)} et ${cardOf(fx.b, fx.by)}${fx.power === 'J' ? ' (Valet)' : ' (Roi noir)'}`, 'swap');
    requestAnimationFrame(() => {
      const ea = slotEl(fx.a), eb = slotEl(fx.b);
      flyCard(ea, eb);
      flyCard(eb, ea);
      markSlots([fx.a, fx.b], 'swapped', 4000);
    });
  } else if (fx.kind === 'replace') {
    if (!me) banner(`${who(fx.by)} a remplacé une de ses cartes`);
    requestAnimationFrame(() => {
      flyCard($('deck'), slotEl(fx.target));
      markSlots([fx.target], 'replaced', 2500);
    });
  } else if (fx.kind === 'look') {
    if (!me) banner(`👁 ${who(fx.by)} regarde ${fx.target.pid === fx.by ? 'une de ses cartes' : cardOf(fx.target, fx.by)}`);
    markSlots([fx.target], 'looked', 2500);
  } else if (fx.kind === 'dutch') {
    banner(`📣 ${who(fx.by)} ${me ? 'as' : 'a'} annoncé <b>DUTCH !</b> Dernier tour.`, 'dutch');
  }
});

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

btnFast.onclick = () => { fastMode = !fastMode; sel = []; render(); };
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
