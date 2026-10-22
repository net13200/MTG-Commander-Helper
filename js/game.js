// Game engine: a game is its setup plus an append-only event log.
// The live state is always derived by replaying the events that are not
// reverted, so undo and "revert any log entry" are the same operation.
(function (root) {
  "use strict";
  const CT = (root.CT = root.CT || {});

  const LETHAL_CMD = 21;
  const LETHAL_POISON = 10;
  const MIN_PLAYERS = 2;
  const MAX_PLAYERS = 6;

  function isSeat(v, n) {
    return Number.isInteger(v) && v >= 0 && v < n;
  }

  function grid(n) {
    return Array.from({ length: n }, () => Array(n).fill(0));
  }

  function emptyPlayer(seat, life) {
    return {
      seat,
      life,
      poison: 0,
      cmd: {}, // "fromSeat:commanderIdx" -> damage taken
      cmdBy: {}, // same key -> who last controlled that commander when it hit
      tax: [0, 0], // casts from the command zone, per own commander
      counters: {},
      cantLose: false,
      cantWin: false,
      out: null, // { by, cause, round }
      lethal: null,
    };
  }

  function nextAlive(st, from, n) {
    for (let k = 1; k <= n; k++) {
      const s = (from + k) % n;
      if (!st.players[s].out) return s;
    }
    return from;
  }

  function apply(st, ev, setup) {
    const n = setup.seats.length;
    const p = st.players[ev.seat];
    switch (ev.type) {
      case "life":
        p.life += ev.delta;
        // A source equal to the player themself means paid life, not damage.
        if (ev.delta < 0 && isSeat(ev.source, n) && ev.source !== ev.seat) st.dealt[ev.source][ev.seat] -= ev.delta;
        break;
      case "cmd": {
        const key = ev.from + ":" + ev.idx;
        // 21 counts per commander; the damage itself goes to its controller,
        // who is its owner unless someone else had taken it (ev.by).
        const by = isSeat(ev.by, n) ? ev.by : ev.from;
        p.cmd[key] = (p.cmd[key] || 0) + ev.delta;
        p.life -= ev.delta;
        if (ev.delta > 0) p.cmdBy[key] = by;
        if (by !== ev.seat) st.dealt[by][ev.seat] += ev.delta;
        break;
      }
      case "poison":
        p.poison += ev.delta;
        break;
      case "tax":
        p.tax[ev.idx] += ev.delta;
        break;
      case "counter":
        p.counters[ev.name] = (p.counters[ev.name] || 0) + ev.delta;
        break;
      case "flag":
        p[ev.flag] = !!ev.value;
        break;
      case "token":
        st[ev.token] = isSeat(ev.seat, n) ? ev.seat : null;
        break;
      case "elim": {
        p.out = { by: isSeat(ev.by, n) ? ev.by : null, cause: ev.cause, round: ev.round || st.round };
        if (isSeat(ev.by, n) && ev.by !== ev.seat) st.knockouts[ev.by]++;
        // Monarch and the Initiative pass to the active player when their
        // holder leaves; to the next player if the leaver was active.
        for (const token of ["monarch", "initiative"]) {
          if (st[token] === ev.seat) {
            const heir = st.active !== ev.seat ? st.active : nextAlive(st, ev.seat, n);
            st[token] = heir === ev.seat ? null : heir;
          }
        }
        break;
      }
      case "turn": {
        const rel = (s) => (s - setup.firstSeat + n) % n;
        const next = nextAlive(st, st.active, n);
        if (rel(next) <= rel(st.active)) st.round++;
        st.active = next;
        st.turns++;
        st.turnStartedAt = ev.t || st.turnStartedAt;
        break;
      }
      // "note" changes nothing on the board.
    }
  }

  function lethalReason(p) {
    if (p.out || p.cantLose) return null;
    for (const [key, dmg] of Object.entries(p.cmd)) {
      if (dmg >= LETHAL_CMD) return { cause: "commander", by: key in p.cmdBy ? p.cmdBy[key] : Number(key.split(":")[0]) };
    }
    if (p.poison >= LETHAL_POISON) return { cause: "poison", by: null };
    if (p.life <= 0) return { cause: "combat", by: null };
    return null;
  }

  function derive(setup, events) {
    const n = setup.seats.length;
    const st = {
      players: setup.seats.map((_, i) => emptyPlayer(i, setup.startingLife)),
      dealt: grid(n), // dealt[from][to], combat plus commander damage
      knockouts: Array(n).fill(0),
      monarch: null,
      initiative: null,
      active: setup.firstSeat,
      round: 1,
      turns: 0,
      turnStartedAt: setup.startedAt,
    };
    for (const ev of events) {
      if (!ev.reverted) apply(st, ev, setup);
    }
    for (const p of st.players) p.lethal = lethalReason(p);
    st.alive = st.players.filter((p) => !p.out).map((p) => p.seat);
    return st;
  }

  // Seat layouts, clockwise around the table. Each entry is
  // [gridRow, gridColumn, rotationDeg]; columns "1 / 3" span the width.
  const LAYOUTS = {
    2: { rows: "1fr 1fr", cols: "1fr", seats: [["1", "1", 180], ["2", "1", 0]] },
    3: { rows: "1.6fr 1fr", cols: "1fr 1fr", seats: [["1", "1", 90], ["1", "2", 270], ["2", "1 / 3", 0]] },
    4: { rows: "1fr 1fr", cols: "1fr 1fr", seats: [["2", "1", 90], ["1", "1", 90], ["1", "2", 270], ["2", "2", 270]] },
    5: {
      rows: "1fr 1fr 0.8fr",
      cols: "1fr 1fr",
      seats: [["2", "1", 90], ["1", "1", 90], ["1", "2", 270], ["2", "2", 270], ["3", "1 / 3", 0]],
    },
    6: {
      rows: "1fr 1fr 1fr",
      cols: "1fr 1fr",
      seats: [["3", "1", 90], ["2", "1", 90], ["1", "1", 90], ["1", "2", 270], ["2", "2", 270], ["3", "2", 270]],
    },
  };

  // On a landscape screen the long edges face the players, so seats sit in a
  // top row (rotated 180°) and a bottom row, still in clockwise order.
  const LANDSCAPE = {
    2: LAYOUTS[2],
    3: { rows: "1fr 1fr", cols: "1fr 1fr", seats: [["2", "1 / 3", 0], ["1", "1", 180], ["1", "2", 180]] },
    4: { rows: "1fr 1fr", cols: "1fr 1fr", seats: [["2", "1", 0], ["1", "1", 180], ["1", "2", 180], ["2", "2", 0]] },
    5: {
      rows: "1fr 1fr",
      cols: "repeat(6, 1fr)",
      seats: [["2", "1 / 4", 0], ["1", "1 / 3", 180], ["1", "3 / 5", 180], ["1", "5 / 7", 180], ["2", "4 / 7", 0]],
    },
    6: { rows: "1fr 1fr", cols: "1fr 1fr 1fr", seats: [["2", "1", 0], ["1", "1", 180], ["1", "2", 180], ["1", "3", 180], ["2", "3", 0], ["2", "2", 0]] },
  };

  function layout(n, landscape) {
    return (landscape ? LANDSCAPE : LAYOUTS)[n];
  }

  function buildMatch(game, end) {
    const { setup, events } = game;
    const st = derive(setup, events);
    const endedAt = end.endedAt || Date.now();
    return {
      id: game.id,
      manual: false,
      date: setup.startedAt,
      startedAt: setup.startedAt,
      endedAt,
      durationMin: Math.max(1, Math.round((endedAt - setup.startedAt) / 60000)),
      startingLife: setup.startingLife,
      firstSeat: setup.firstSeat,
      rounds: st.round,
      seats: setup.seats.map((s) => ({
        playerId: s.playerId,
        name: s.name,
        deckId: s.deckId || null,
        deckName: s.deckName || "",
        commanders: s.commanders || [],
      })),
      winnerSeat: isSeat(end.winnerSeat, setup.seats.length) ? end.winnerSeat : null,
      winType: end.winType,
      eliminations: st.players.filter((p) => p.out).map((p) => ({ seat: p.seat, ...p.out })),
      damage: st.dealt,
      finalLife: st.players.map((p) => p.life),
      notes: events.filter((e) => e.type === "note" && !e.reverted).map((e) => e.text),
      events: events.filter((e) => !e.reverted),
    };
  }

  CT.Game = { derive, buildMatch, nextAlive, layout, LETHAL_CMD, LETHAL_POISON, MIN_PLAYERS, MAX_PLAYERS };
  if (typeof module !== "undefined") module.exports = CT.Game;
})(typeof window !== "undefined" ? window : globalThis);
