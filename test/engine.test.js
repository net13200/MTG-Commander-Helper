// Run with: node --test test/
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const Game = require("../js/game.js");
const Stats = require("../js/stats.js");

const seats = (n) => Array.from({ length: n }, (_, i) => ({ playerId: "p" + i, name: "P" + i, commanders: ["Cmd" + i] }));
const setup = (n, first = 0) => ({ seats: seats(n), startingLife: 40, firstSeat: first, startedAt: 0 });

test("life, attribution and commander damage feed the damage matrix", () => {
  const st = Game.derive(setup(4), [
    { type: "life", seat: 1, delta: -7, source: 0 },
    { type: "cmd", seat: 1, from: 2, idx: 0, delta: 5 },
    { type: "life", seat: 1, delta: 3, source: null },
  ]);
  assert.equal(st.players[1].life, 31);
  assert.equal(st.dealt[0][1], 7);
  assert.equal(st.dealt[2][1], 5);
  assert.equal(st.players[1].cmd["2:0"], 5);
});

test("reverted events are skipped", () => {
  const st = Game.derive(setup(2), [{ type: "life", seat: 0, delta: -10, reverted: true }]);
  assert.equal(st.players[0].life, 40);
});

test("lethal checks: 21 commander, 10 poison, 0 life, can't lose", () => {
  const s = setup(3);
  assert.deepEqual(Game.derive(s, [{ type: "cmd", seat: 0, from: 1, idx: 0, delta: 21 }]).players[0].lethal, { cause: "commander", by: 1 });
  assert.equal(Game.derive(s, [{ type: "poison", seat: 0, delta: 10 }]).players[0].lethal.cause, "poison");
  assert.equal(Game.derive(s, [{ type: "life", seat: 0, delta: -40 }]).players[0].lethal.cause, "combat");
  assert.equal(Game.derive(s, [{ type: "life", seat: 0, delta: -40 }, { type: "flag", seat: 0, flag: "cantLose", value: true }]).players[0].lethal, null);
});

test("turns skip eliminated players and count rounds from the first player", () => {
  const s = setup(4, 2);
  const turn = { type: "turn" };
  let st = Game.derive(s, [turn, turn]);
  assert.equal(st.active, 0);
  assert.equal(st.round, 1);
  st = Game.derive(s, [turn, turn, turn, turn]);
  assert.equal(st.active, 2);
  assert.equal(st.round, 2);
  st = Game.derive(s, [{ type: "elim", seat: 3, by: 0, cause: "combat" }, turn]);
  assert.equal(st.active, 0);
  assert.equal(st.knockouts[0], 1);
  assert.deepEqual(st.alive, [0, 1, 2]);
});

test("monarch passes to the active player when its holder is knocked out", () => {
  const st = Game.derive(setup(4, 0), [
    { type: "token", token: "monarch", seat: 2 },
    { type: "elim", seat: 2, by: 0, cause: "combat" },
  ]);
  assert.equal(st.monarch, 0);
});

test("buildMatch and stats", () => {
  const s = setup(3, 1);
  s.startedAt = 0;
  const events = [
    { type: "life", seat: 0, delta: -40, source: 1 },
    { type: "elim", seat: 0, by: 1, cause: "combat" },
    { type: "cmd", seat: 2, from: 1, idx: 0, delta: 21 },
    { type: "elim", seat: 2, by: 1, cause: "commander" },
    { type: "note", text: "gg" },
  ];
  const m = Game.buildMatch({ id: "m1", setup: s, events }, { winnerSeat: 1, winType: "last", endedAt: 30 * 60000 });
  assert.equal(m.durationMin, 30);
  assert.deepEqual(m.notes, ["gg"]);
  const st = Stats.compute([m]);
  const p1 = st.players.find((r) => r.id === "p1");
  assert.equal(p1.wins, 1);
  assert.equal(p1.damage, 61);
  assert.equal(p1.knockouts, 2);
  assert.equal(st.turnOrder[0].wins, 1);
  assert.equal(st.mostKnockouts.id, "p1");
  assert.equal(st.avgMinutes, 30);
});

test("every UI string key exists in English and Hebrew", () => {
  global.window = global;
  global.document = { documentElement: {} };
  require("../js/i18n.js");
  const { en, he } = global.CT.I18n.DICTS;
  assert.deepEqual(Object.keys(he).filter((k) => !(k in en)), []);
  assert.deepEqual(Object.keys(en).filter((k) => !(k in he)), []);
  const src = ["app.js", "recap.js", "decks.js"].map((f) => fs.readFileSync(path.join(__dirname, "../js", f), "utf8")).join("\n");
  const used = [...src.matchAll(/\b(?:t|I18n\.raw|say)\("([A-Za-z_]+)"/g), ...src.matchAll(/key: "([A-Za-z_]+)"/g)].map((m) => m[1]);
  // Keys ending in "_" are prefixes completed at runtime (cause_combat, ...).
  assert.deepEqual([...new Set(used)].filter((k) => !k.endsWith("_") && !(k in en)), []);
});

test("every pod size has a seat for each player in both orientations", () => {
  for (let n = Game.MIN_PLAYERS; n <= Game.MAX_PLAYERS; n++) {
    for (const landscape of [false, true]) assert.equal(Game.layout(n, landscape).seats.length, n);
  }
});

test("paid life is not damage; a stolen commander's damage goes to its controller", () => {
  const st = Game.derive(setup(3), [
    { type: "life", seat: 0, delta: -7, source: 0 },
    { type: "cmd", seat: 1, from: 2, idx: 0, delta: 15 },
    { type: "cmd", seat: 1, from: 2, idx: 0, delta: 6, by: 0 },
  ]);
  assert.equal(st.players[0].life, 33);
  assert.equal(st.dealt[0][0], 0);
  assert.equal(st.dealt[2][1], 15);
  assert.equal(st.dealt[0][1], 6);
  assert.equal(st.players[1].cmd["2:0"], 21);
  assert.deepEqual(st.players[1].lethal, { cause: "commander", by: 0 });
});
