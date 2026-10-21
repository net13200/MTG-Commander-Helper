// Stats are computed from saved matches on demand; nothing is cached.
(function (root) {
  "use strict";
  const CT = (root.CT = root.CT || {});

  function bump(map, key, init) {
    if (!map[key]) map[key] = init();
    return map[key];
  }

  function rate(row) {
    return row.games ? row.wins / row.games : 0;
  }

  function compute(matches) {
    const players = {};
    const decks = {};
    const turnOrder = [];
    const seats = [];
    let roundsSum = 0;
    let roundsN = 0;
    let minutesSum = 0;
    let minutesN = 0;

    for (const m of matches) {
      const n = m.seats.length;
      m.seats.forEach((s, i) => {
        const won = m.winnerSeat === i;
        const pl = bump(players, s.playerId, () => ({ id: s.playerId, name: s.name, games: 0, wins: 0, damage: 0, knockouts: 0 }));
        pl.games++;
        if (won) pl.wins++;
        if (m.damage && m.damage[i]) pl.damage += m.damage[i].reduce((a, b) => a + b, 0) - (m.damage[i][i] || 0);

        if (s.deckId) {
          const dk = bump(decks, s.deckId, () => ({ id: s.deckId, name: s.deckName, ownerId: s.playerId, games: 0, wins: 0 }));
          dk.games++;
          if (won) dk.wins++;
        }

        const seatRow = (seats[i] = seats[i] || { games: 0, wins: 0 });
        seatRow.games++;
        if (won) seatRow.wins++;

        if (Number.isInteger(m.firstSeat)) {
          const pos = (i - m.firstSeat + n) % n;
          const row = (turnOrder[pos] = turnOrder[pos] || { games: 0, wins: 0 });
          row.games++;
          if (won) row.wins++;
        }
      });

      for (const e of m.eliminations || []) {
        if (Number.isInteger(e.by) && e.by !== e.seat && m.seats[e.by]) {
          players[m.seats[e.by].playerId].knockouts++;
        }
      }
      if (m.rounds) {
        roundsSum += m.rounds;
        roundsN++;
      }
      if (!m.manual && m.durationMin) {
        minutesSum += m.durationMin;
        minutesN++;
      }
    }

    const fill = (arr) => Array.from(arr, (r) => r || { games: 0, wins: 0 });
    const playerRows = Object.values(players).sort((a, b) => rate(b) - rate(a) || b.games - a.games);
    const deckRows = Object.values(decks).sort((a, b) => rate(b) - rate(a) || b.games - a.games);
    const top = (key) => playerRows.reduce((best, r) => (r[key] > 0 && (!best || r[key] > best[key]) ? r : best), null);

    return {
      games: matches.length,
      avgRounds: roundsN ? roundsSum / roundsN : null,
      avgMinutes: minutesN ? minutesSum / minutesN : null,
      players: playerRows,
      decks: deckRows,
      turnOrder: fill(turnOrder),
      seats: fill(seats),
      mostDamage: top("damage"),
      mostKnockouts: top("knockouts"),
    };
  }

  // ---------- Rivalries ----------

  // rows[a][b] describes a against b over every match both took part in.
  // kind "player" keys by profile, "deck" by deck (games without a deck skip).
  function headToHead(matches, kind) {
    const keyOf = (s) => (kind === "deck" ? s.deckId || null : s.playerId);
    const rows = {};
    const cell = (a, b) => {
      rows[a] = rows[a] || {};
      return (rows[a][b] = rows[a][b] || { games: 0, wins: 0, losses: 0, koGiven: 0, koTaken: 0 });
    };
    for (const m of matches) {
      const ids = m.seats.map(keyOf);
      ids.forEach((a, i) => {
        ids.forEach((b, j) => {
          if (i === j || !a || !b || a === b) return;
          const c = cell(a, b);
          c.games++;
          if (m.winnerSeat === i) c.wins++;
          if (m.winnerSeat === j) c.losses++;
        });
      });
      for (const e of m.eliminations || []) {
        const a = ids[e.by];
        const b = ids[e.seat];
        if (!Number.isInteger(e.by) || e.by === e.seat || !a || !b || a === b) continue;
        cell(a, b).koGiven++;
        cell(b, a).koTaken++;
      }
    }
    return rows;
  }

  function topBy(row, key) {
    let best = null;
    for (const [id, r] of Object.entries(row || {})) if (r[key] > 0 && (!best || r[key] > best.r[key])) best = { id, r };
    return best;
  }

  // ---------- Seasons (calendar quarters) ----------

  function seasonKey(ts) {
    const d = new Date(ts);
    return d.getFullYear() + "-Q" + (Math.floor(d.getMonth() / 3) + 1);
  }

  function seasons(matches, now) {
    const keys = new Set(matches.map((m) => seasonKey(m.date)));
    keys.add(seasonKey(now || Date.now()));
    return [...keys].sort().reverse();
  }

  function inSeason(matches, key) {
    return key ? matches.filter((m) => seasonKey(m.date) === key) : matches;
  }

  // Standings rank by wins, then win rate; awards need at least two games.
  function awards(matches) {
    const s = compute(matches);
    const standings = [...s.players].sort((a, b) => b.wins - a.wins || rate(b) - rate(a) || b.games - a.games);
    const bestDeck = s.decks.filter((d) => d.games >= 2).sort((a, b) => rate(b) - rate(a) || b.wins - a.wins)[0] || null;
    return { stats: s, standings, champion: standings[0] && standings[0].wins ? standings[0] : null, mostDamage: s.mostDamage, mostKnockouts: s.mostKnockouts, bestDeck };
  }

  CT.Stats = { compute, rate, headToHead, topBy, seasonKey, seasons, inSeason, awards };
  if (typeof module !== "undefined") module.exports = CT.Stats;
})(typeof window !== "undefined" ? window : globalThis);
