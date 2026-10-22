// Run with: node --test test/
const test = require("node:test");
const assert = require("node:assert");
const Share = require("../js/share.js");

const phoneA = () => ({
  players: [
    { id: "a1", name: "Dor", color: "#e5484d", avatar: "🦁", moxfieldUser: "dor" },
    { id: "a2", name: "Tamir", color: "#46a758", avatar: "🌲" },
    { id: "a3", name: "Guesty", guest: true },
  ],
  decks: [
    { id: "dA", ownerId: "a1", name: "Doctor", commanders: ["The Tenth Doctor", "Rose Tyler"], list: "1 The Tenth Doctor\n1 Rose Tyler", fp: "fp1", version: 1, analysis: { big: true } },
    { id: "dB", ownerId: "a2", name: "Lumra", commanders: ["Lumra"], list: "1 Lumra", fp: "fpL", version: 1 },
  ],
  matches: [{ id: "m1", date: 1, seats: [{ playerId: "a1", name: "Dor" }, { playerId: "a2", name: "Tamir" }, { playerId: "zz", name: "Shlomi" }], winnerSeat: 0 }],
});

test("encode/decode round-trips through a compact link-safe string", async () => {
  const pack = Share.pack(phoneA(), ["a1", "a2"], true);
  const code = await Share.encode(pack);
  assert.match(code, /^[zj][A-Za-z0-9_-]+$/);
  assert.deepEqual(await Share.decode(code), pack);
  assert.ok(code.length < JSON.stringify(pack).length * 1.4);
});

test("pack sends lists, not check results, and skips unchosen players", () => {
  const pack = Share.pack(phoneA(), ["a1"], false);
  assert.deepEqual(pack.players.map((p) => p.name), ["Dor"]);
  assert.equal(pack.decks.length, 1);
  assert.equal(pack.decks[0].analysis, undefined);
  assert.deepEqual(pack.matches, []);
});

test("merge matches people by name, updates changed decks and adds games once", () => {
  const phoneB = {
    players: [{ id: "b1", name: "dor", color: "#000", avatar: "D" }, { id: "b9", name: "Shlomi" }],
    decks: [{ id: "x", ownerId: "b1", name: "Doctor", commanders: ["The Tenth Doctor"], list: "old", fp: "old", version: 3 }],
    matches: [],
  };
  const pack = Share.pack(phoneA(), ["a1", "a2"], true);
  const res = Share.merge(phoneB, pack);
  assert.equal(res.playersMatched, 1);
  assert.equal(res.playersAdded, 1);
  assert.equal(phoneB.players.length, 3);
  assert.equal(phoneB.players[0].moxfieldUser, "dor");
  const doc = phoneB.decks.find((d) => d.ownerId === "b1");
  assert.equal(doc.fp, "fp1");
  assert.equal(doc.version, 4);
  assert.equal(res.decksAdded, 1);
  assert.deepEqual(phoneB.matches[0].seats.map((s) => s.playerId), ["b1", "a2", "b9"]);
  assert.equal(Share.merge(phoneB, pack).matchesAdded, 0);
  assert.equal(Share.merge(phoneB, pack).decksUpdated, 0);
});
