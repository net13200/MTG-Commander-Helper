// Writes a short story of a saved match from its log: the swing round, the
// first knockout, the comeback and the kingmaker. Returns plain-text lines;
// `say(key, vars)` supplies the wording so the recap follows the UI language.
(function (root) {
  "use strict";
  const CT = (root.CT = root.CT || {});

  function recap(m, say) {
    const seats = m.seats;
    const nm = (i) => (seats[i] ? seats[i].name : "?");
    const lines = [];
    const n = seats.length;
    const winner = Number.isInteger(m.winnerSeat) ? m.winnerSeat : null;

    lines.push(say(Number.isInteger(m.firstSeat) ? "rc_intro" : "rc_introManual", { n, first: nm(m.firstSeat) }));

    const events = m.events || [];
    if (events.length) {
      // Damage per round, and who dealt it.
      const rounds = {};
      const life = seats.map(() => m.startingLife || 40);
      const low = life.slice();
      for (const e of events) {
        let dmg = 0;
        let src = null;
        if (e.type === "life") {
          life[e.seat] += e.delta;
          if (e.delta < 0 && e.source !== e.seat) {
            dmg = -e.delta;
            src = Number.isInteger(e.source) ? e.source : null;
          }
        } else if (e.type === "cmd") {
          life[e.seat] -= e.delta;
          if (e.delta > 0) {
            dmg = e.delta;
            src = Number.isInteger(e.by) ? e.by : e.from;
          }
        }
        if (life[e.seat] < low[e.seat]) low[e.seat] = life[e.seat];
        if (!dmg) continue;
        const r = (rounds[e.round || 1] = rounds[e.round || 1] || { total: 0, by: {} });
        r.total += dmg;
        if (src != null) r.by[src] = (r.by[src] || 0) + dmg;
      }

      const swing = Object.entries(rounds).sort((a, b) => b[1].total - a[1].total)[0];
      if (swing && swing[1].total >= 15 && (m.rounds || 1) > 1) {
        const top = Object.entries(swing[1].by).sort((a, b) => b[1] - a[1])[0];
        lines.push(say(top ? "rc_swing" : "rc_swingAnon", { r: swing[0], dmg: swing[1].total, name: top ? nm(Number(top[0])) : "" }));
      }

      const firstOut = events.find((e) => e.type === "elim");
      if (firstOut) {
        const by = Number.isInteger(firstOut.by) && firstOut.by !== firstOut.seat;
        lines.push(say(by ? "rc_firstOutBy" : "rc_firstOut", { name: nm(firstOut.seat), r: firstOut.round || 1, killer: by ? nm(firstOut.by) : "", cause: say("cause_" + firstOut.cause) }));
      }

      const start = m.startingLife || 40;
      if (winner != null && low[winner] <= Math.max(5, Math.round(start / 4)) && low[winner] < start) {
        lines.push(say("rc_comeback", { name: nm(winner), life: Math.max(low[winner], 0) }));
      }

      // Kingmaker: the loser whose damage most softened up the players the
      // winner later knocked out.
      if (winner != null && m.damage) {
        const finished = (m.eliminations || []).filter((e) => e.by === winner).map((e) => e.seat);
        let best = null;
        for (let x = 0; x < n; x++) {
          if (x === winner) continue;
          const dmg = finished.reduce((sum, v) => sum + (v !== x ? m.damage[x][v] || 0 : 0), 0);
          if (dmg >= 15 && (!best || dmg > best.dmg)) best = { x, dmg };
        }
        if (best) lines.push(say("rc_kingmaker", { name: nm(best.x), dmg: best.dmg, winner: nm(winner) }));
      }
    }

    if (winner == null) lines.push(say("rc_draw"));
    else {
      const deck = seats[winner].deckName;
      const life = m.finalLife ? m.finalLife[winner] : null;
      lines.push(say(deck ? "rc_winDeck" : "rc_win", { name: nm(winner), deck, how: say("win_" + (m.winType || "last")) }) + (life != null ? " " + say("rc_atLife", { life }) : ""));
    }
    if (m.rounds && m.durationMin) lines.push(say("rc_length", { r: m.rounds, min: m.durationMin }));
    else if (m.rounds) lines.push(say("rc_lengthRounds", { r: m.rounds }));
    for (const note of m.notes || []) lines.push("📝 " + note);
    return lines;
  }

  CT.Recap = { recap };
  if (typeof module !== "undefined") module.exports = CT.Recap;
})(typeof window !== "undefined" ? window : globalThis);
