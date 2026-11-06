// Moteur de règles du Dutch (version maison)
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SCORE_LIMIT = 200;

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makeDeck() {
  const d = [];
  let id = 0;
  for (const s of SUITS) for (const r of RANKS) d.push({ id: id++, rank: r, suit: s });
  d.push({ id: id++, rank: 'JK', suit: null });
  d.push({ id: id++, rank: 'JK', suit: null });
  return shuffle(d);
}

const isRed = (c) => c.suit === '♥' || c.suit === '♦';

function value(c) {
  if (c.rank === 'JK') return -1;
  if (c.rank === 'A') return 1;
  if (c.rank === 'J') return 11;
  if (c.rank === 'Q') return 12;
  if (c.rank === 'K') return isRed(c) ? 0 : 13;
  return parseInt(c.rank, 10);
}

// Pouvoir activé quand la carte est défaussée directement depuis la pioche
function power(c) {
  if (c.rank === '7') return '7';
  if (c.rank === '10') return '10';
  if (c.rank === 'J') return 'J';
  if (c.rank === 'K' && !isRed(c)) return 'K';
  return null;
}

function label(c) {
  if (!c) return '?';
  if (c.rank === 'JK') return 'Joker';
  const names = { A: 'As', J: 'Valet', Q: 'Dame', K: 'Roi' };
  return `${names[c.rank] || c.rank}${c.suit}`;
}

class Game {
  constructor(players) {
    this.players = players.map((p) => ({ id: p.id, name: p.name, total: 0, hand: [], ready: false }));
    this.round = 0;
    this.dealer = -1;
    this.events = [];
    this.log = [];
    this.seq = 0;
    this.startRound();
  }

  emit(to, type, data) { this.events.push({ to, type, data }); }
  takeEvents() { const e = this.events; this.events = []; return e; }
  addLog(msg) { this.log.push(msg); if (this.log.length > 60) this.log.shift(); }
  idx(pid) { return this.players.findIndex((p) => p.id === pid); }
  get(pid) { return this.players[this.idx(pid)]; }
  slotName(pid, slot) { return `la carte n°${slot + 1} de ${this.get(pid).name}`; }
  highlight(kind, slots) { this.hl = { seq: ++this.seq, kind, slots }; }

  startRound() {
    const n = this.players.length;
    this.round++;
    this.dealer = (this.dealer + 1) % n;
    this.deck = makeDeck();
    this.discard = [];
    for (const p of this.players) {
      p.hand = [this.deck.pop(), this.deck.pop(), this.deck.pop(), this.deck.pop()];
      p.ready = false;
    }
    this.discard.push(this.deck.pop());
    this.phase = 'peek';
    this.turn = (this.dealer + 1) % n;
    this.step = 'start';
    this.drawn = null;
    this.pending = null;
    this.dutchBy = null;
    this.dutchStop = null;
    this.fastPowers = {}; // pid -> pouvoirs gagnés par défausse rapide, en attente
    this.roundResult = null;
    this.hl = null;
    this.addLog(`— Manche ${this.round} —`);
  }

  drawCard() {
    if (this.deck.length === 0) {
      if (this.discard.length <= 1) return null;
      const top = this.discard.pop();
      this.deck = shuffle(this.discard);
      this.discard = [top];
      this.addLog('La défausse est remélangée dans la pioche.');
    }
    return this.deck.pop();
  }

  isTurn(pid, step) {
    return this.phase === 'play' && this.players[this.turn].id === pid && this.step === step;
  }

  validTarget(t) {
    if (!t || typeof t !== 'object') return false;
    const p = this.get(t.pid);
    return !!p && Number.isInteger(t.slot) && t.slot >= 0 && t.slot < p.hand.length && p.hand[t.slot] !== null;
  }

  act(pid, a) {
    if (!a || typeof a.type !== 'string') return 'Action invalide';
    const me = this.get(pid);
    if (!me) return 'Joueur inconnu';

    switch (a.type) {
      case 'ready': {
        if (this.phase !== 'peek') return 'Pas maintenant';
        me.ready = true;
        this.checkAllReady();
        return null;
      }
      case 'draw': {
        if (!this.isTurn(pid, 'start')) return "Ce n'est pas le moment de piocher";
        const c = this.drawCard();
        if (!c) return 'Plus de cartes dans la pioche';
        this.drawn = c;
        this.step = 'drawn';
        this.addLog(`${me.name} pioche une carte.`);
        return null;
      }
      case 'dutch': {
        // Dutch peut être annoncé à tout moment ; le tour de table continue
        // jusqu'au joueur qui était en train de jouer au moment de l'annonce.
        if (this.phase !== 'play') return 'Pas maintenant';
        if (this.dutchBy) return 'Dutch a déjà été annoncé';
        this.dutchBy = pid;
        this.dutchStop = this.turn;
        const cur = this.players[this.turn];
        this.addLog(`📣 ${me.name} annonce DUTCH ! La manche s'arrête quand le tour revient à ${cur.name}.`);
        this.emit('all', 'fx', { kind: 'dutch', by: pid, stop: cur.id });
        return null;
      }
      case 'swap': {
        if (!this.isTurn(pid, 'drawn')) return 'Pas maintenant';
        const t = { pid, slot: a.slot };
        if (!this.validTarget(t)) return 'Carte invalide';
        const old = me.hand[a.slot];
        me.hand[a.slot] = this.drawn;
        this.discard.push(old);
        this.drawn = null;
        this.highlight('swap', [t]);
        this.emit('all', 'fx', { kind: 'replace', by: pid, target: t, old });
        this.addLog(`${me.name} remplace sa carte n°${a.slot + 1} et défausse ${label(old)}.`);
        // La carte qui sort de la main active aussi son pouvoir
        const pw = power(old);
        if (pw) {
          this.step = 'power';
          this.pending = pw;
        } else {
          this.endTurn();
        }
        return null;
      }
      case 'discard': {
        if (!this.isTurn(pid, 'drawn')) return 'Pas maintenant';
        const c = this.drawn;
        this.discard.push(c);
        this.drawn = null;
        this.addLog(`${me.name} défausse ${label(c)}.`);
        const pw = power(c);
        if (pw) {
          this.step = 'power';
          this.pending = pw;
        } else {
          this.endTurn();
        }
        return null;
      }
      case 'skip': {
        if (a.fast) {
          const q = this.fastPowers[pid];
          if (!q || !q.length) return 'Aucun pouvoir en attente';
          q.shift();
          this.addLog(`${me.name} n'utilise pas le pouvoir.`);
          return null;
        }
        if (!this.isTurn(pid, 'power')) return 'Pas maintenant';
        this.addLog(`${me.name} n'utilise pas le pouvoir.`);
        this.endTurn();
        return null;
      }
      case 'power': {
        if (a.fast) {
          // Pouvoir gagné par une défausse rapide : utilisable même hors de son tour
          if (this.phase !== 'play') return 'Pas maintenant';
          const q = this.fastPowers[pid];
          if (!q || !q.length) return 'Aucun pouvoir en attente';
          const err = this.applyPower(pid, q[0], a.targets);
          if (!err) q.shift();
          return err;
        }
        if (!this.isTurn(pid, 'power')) return 'Pas maintenant';
        const err = this.applyPower(pid, this.pending, a.targets);
        if (!err) this.endTurn();
        return err;
      }
      case 'fast': return this.fastDiscard(pid, a.target);
      default: return 'Action inconnue';
    }
  }

  checkAllReady() {
    if (this.phase === 'peek' && this.players.every((p) => p.ready)) {
      this.phase = 'play';
      this.addLog(`${this.players[this.turn].name} commence.`);
    }
  }

  // Applique un pouvoir (7, 10, Valet, Roi noir). Ne termine pas le tour.
  applyPower(pid, p, targets) {
    if (!Array.isArray(targets) || !targets.every((t) => this.validTarget(t))) return 'Cible invalide';
    const me = this.get(pid);

    if (p === '7' || p === '10') {
      if (targets.length !== 1) return 'Choisis une carte';
      const t = targets[0];
      if (p === '7' && t.pid !== pid) return 'Le 7 sert à regarder une de TES cartes';
      if (p === '10' && t.pid === pid) return "Le 10 sert à regarder la carte d'un autre joueur";
      this.emit(pid, 'peek', { cards: [{ ...t, card: this.get(t.pid).hand[t.slot] }] });
      this.highlight('look', [t]);
      this.addLog(`👁 ${me.name} regarde ${t.pid === pid ? 'une de ses cartes' : `une carte de ${this.get(t.pid).name}`}.`);
      this.emit('all', 'fx', { kind: 'look', by: pid, target: t });
      return null;
    }

    if (p === 'J' || p === 'K') {
      if (targets.length !== 2) return 'Choisis deux cartes';
      const [a, b] = targets;
      if (a.pid === b.pid && a.slot === b.slot) return 'Choisis deux cartes différentes';
      const pa = this.get(a.pid), pb = this.get(b.pid);
      [pa.hand[a.slot], pb.hand[b.slot]] = [pb.hand[b.slot], pa.hand[a.slot]];
      this.highlight('swap', [a, b]);
      this.emit('all', 'fx', { kind: 'swap', by: pid, a, b, power: p });
      const whose = (t) => (t.pid === pid ? 'sa carte' : `la carte de ${this.get(t.pid).name}`);
      this.addLog(`🔄 ${me.name} échange ${whose(a)} et ${whose(b)} (${p === 'J' ? 'Valet' : 'Roi noir'}).`);
      // Roi noir : on regarde la carte qu'on a récupérée (si une de ses cartes fait partie de l'échange)
      if (p === 'K') {
        const mine = [a, b].filter((t) => t.pid === pid);
        if (mine.length) this.emit(pid, 'peek', { cards: mine.map((t) => ({ ...t, card: me.hand[t.slot] })) });
      }
      return null;
    }
    return 'Aucun pouvoir en attente';
  }

  fastDiscard(pid, t) {
    if (this.phase !== 'play') return 'Pas maintenant';
    if (!this.discard.length) return 'La défausse est vide';
    if (!this.validTarget(t)) return 'Carte invalide';
    const me = this.get(pid);
    const owner = this.get(t.pid);
    const card = owner.hand[t.slot];
    const top = this.discard[this.discard.length - 1];
    const own = t.pid === pid;

    if (card.rank === top.rank) {
      owner.hand[t.slot] = null;
      this.discard.push(card);
      const pw = power(card);
      if (pw) {
        (this.fastPowers[pid] ||= []).push(pw);
        this.emit(pid, 'fx', { kind: 'gotPower', by: pid, power: pw });
      }
      if (own) {
        this.addLog(`⚡ ${me.name} défausse rapidement ${label(card)} !`);
        this.highlight('fast', []);
      } else {
        const repl = this.drawCard();
        owner.hand[t.slot] = repl;
        const pen = this.drawCard();
        if (pen) owner.hand.push(pen);
        this.highlight('fast', [t, ...(pen ? [{ pid: t.pid, slot: owner.hand.length - 1 }] : [])]);
        this.addLog(`⚡ ${me.name} défausse ${label(card)} de ${owner.name} ! ${owner.name} reçoit une carte de remplacement + 1 pénalité.`);
      }
    } else {
      // Erreur : la carte est montrée à tous puis reste en place
      this.emit('all', 'flash', { pid: t.pid, slot: t.slot, card });
      const n = own ? 2 : 1;
      const added = [];
      for (let i = 0; i < n; i++) {
        const c = this.drawCard();
        if (c) { me.hand.push(c); added.push({ pid, slot: me.hand.length - 1 }); }
      }
      this.highlight('penalty', added);
      this.addLog(`❌ ${me.name} se trompe (${label(card)} ≠ ${label(top)}) et prend ${n} carte${n > 1 ? 's' : ''} de pénalité.`);
    }
    return null;
  }

  // Débloquer la partie si un joueur est déconnecté (action de l'hôte)
  force() {
    if (this.phase === 'peek') {
      for (const p of this.players) p.ready = true;
      this.checkAllReady();
      return null;
    }
    if (this.phase === 'play') {
      if (this.drawn) { this.discard.push(this.drawn); this.drawn = null; }
      this.addLog(`Le tour de ${this.players[this.turn].name} est passé.`);
      this.endTurn();
      return null;
    }
    return 'Rien à débloquer';
  }

  endTurn() {
    this.drawn = null;
    this.pending = null;
    this.step = 'start';
    const next = (this.turn + 1) % this.players.length;
    if (this.dutchBy && next === this.dutchStop) {
      this.endRound();
      return;
    }
    this.turn = next;
  }

  endRound() {
    const scores = this.players.map((p) => p.hand.filter(Boolean).reduce((s, c) => s + value(c), 0));
    const min = Math.min(...scores);
    const ci = this.idx(this.dutchBy);
    const failed = ci >= 0 && scores[ci] > min;
    const rows = this.players.map((p, i) => {
      let pts = scores[i];
      const doubled = i === ci && failed && pts > 0;
      if (doubled) pts *= 2;
      p.total += pts;
      return { pid: p.id, name: p.name, score: scores[i], points: pts, doubled, total: p.total };
    });
    this.roundResult = { rows, dutchBy: this.dutchBy, failed };
    const caller = this.get(this.dutchBy);
    this.addLog(failed ? `${caller.name} a raté son Dutch : points doublés !` : `${caller.name} réussit son Dutch !`);
    this.phase = this.players.some((p) => p.total >= SCORE_LIMIT) ? 'gameOver' : 'roundEnd';
    if (this.phase === 'gameOver') {
      const best = Math.min(...this.players.map((p) => p.total));
      this.winners = this.players.filter((p) => p.total === best).map((p) => p.name);
      this.addLog(`🏆 Partie terminée ! Victoire de ${this.winners.join(' et ')}.`);
    }
  }

  nextRound() {
    if (this.phase !== 'roundEnd') return 'Pas maintenant';
    this.startRound();
    return null;
  }

  view(pid) {
    const reveal = this.phase === 'roundEnd' || this.phase === 'gameOver';
    const me = this.get(pid);
    const cur = this.players[this.turn];
    return {
      phase: this.phase,
      round: this.round,
      scoreLimit: SCORE_LIMIT,
      turn: cur.id,
      step: this.step,
      pending: this.pending,
      dutchBy: this.dutchBy,
      dutchStop: this.dutchBy ? this.players[this.dutchStop].id : null,
      myFastPowers: (this.fastPowers && this.fastPowers[pid]) || [],
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        total: p.total,
        ready: p.ready,
        hand: p.hand.map((c) => (c === null ? null : reveal ? { ...c, value: value(c) } : { hidden: true })),
      })),
      deckCount: this.deck.length,
      discardTop: this.discard[this.discard.length - 1] || null,
      discardCount: this.discard.length,
      drawn: cur.id === pid ? this.drawn : null,
      someoneDrawn: !!this.drawn,
      drawnPower: cur.id === pid && this.drawn ? power(this.drawn) : null,
      peekNow: this.phase === 'peek' && me && !me.ready
        ? [2, 3].map((slot) => ({ pid, slot, card: me.hand[slot] }))
        : null,
      roundResult: this.roundResult,
      winners: this.phase === 'gameOver' ? this.winners : null,
      highlight: this.hl,
      log: this.log.slice(-14),
    };
  }
}

module.exports = { Game, value, power, label };
