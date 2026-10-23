// Run with: node --test test/
const test = require("node:test");
const assert = require("node:assert");
const Decks = require("../js/decks.js");
const Stats = require("../js/stats.js");
const { recap } = require("../js/recap.js");

test("parses Moxfield, Archidekt and MTGO style exports", () => {
  const mox = Decks.parseList("Commander\n1 Atraxa, Praetors' Voice (2X2) 190 *F*\n\nDeck\n1 Sol Ring (CMM) 400\n2 Forest\n1 Sol Ring\n\nSideboard\n1 Lightning Bolt");
  assert.deepEqual(mox.commanders, ["Atraxa, Praetors' Voice"]);
  assert.deepEqual(mox.cards, [{ q: 1, n: "Atraxa, Praetors' Voice" }, { q: 2, n: "Sol Ring" }, { q: 2, n: "Forest" }]);

  const arch = Decks.parseList("1x Krenko, Mob Boss (ddt) 52 [Commander{top}]\n1x Goblin Bombardment (tpr) 135 [Sac Outlet] ^Have,#37d67a^");
  assert.deepEqual(arch.commanders, ["Krenko, Mob Boss"]);
  assert.equal(arch.cards[1].n, "Goblin Bombardment");

  const headers = Decks.parseList("// Commander\n1 Krenko, Mob Boss\nCreatures (2)\n1 Goblin Lackey\nSkullclamp");
  assert.deepEqual(headers.commanders, ["Krenko, Mob Boss"]);
  assert.deepEqual(headers.cards.map((c) => c.n), ["Krenko, Mob Boss", "Goblin Lackey", "Skullclamp"]);
});

test("fingerprint ignores order; toText round-trips", () => {
  const a = Decks.parseList("1 A\n1 B");
  const b = Decks.parseList("1 B\n1 A");
  assert.equal(Decks.fingerprint(a.cards), Decks.fingerprint(b.cards));
  const text = Decks.toText([{ q: 1, n: "Cmd" }, { q: 1, n: "X" }], ["Cmd"]);
  assert.deepEqual(Decks.parseList(text).commanders, ["Cmd"]);
});

test("reads both Moxfield response shapes and deck links", () => {
  assert.equal(Decks.moxfieldId("https://www.moxfield.com/decks/AbC-123_xyz"), "AbC-123_xyz");
  assert.equal(Decks.moxfieldId("not a link"), null);
  const v2 = Decks.fromMoxfield({ name: "D", commanders: { K: { quantity: 1, card: { name: "K" } } }, mainboard: { S: { quantity: 1, card: { name: "S" } } } });
  const v3 = Decks.fromMoxfield({ name: "D", boards: { commanders: { cards: { x: { quantity: 1, card: { name: "K" } } } }, mainboard: { cards: { y: { quantity: 1, card: { name: "S" } } } } } });
  assert.deepEqual(v2, v3);
  assert.deepEqual(v2.commanders, ["K"]);
});

test("deck check flags banned, off-color, Game Changers and estimates brackets", () => {
  const card = (name, extra) => ({ name, type: "Artifact", text: "", ci: [], legal: "legal", gc: false, ...extra });
  const lookup = new Map(
    [
      card("Sol Ring"),
      card("Mana Crypt", { legal: "banned" }),
      card("Swords to Plowshares", { ci: ["W"] }),
      card("Rhystic Study", { gc: true, ci: ["U"] }),
      card("Time Warp", { text: "Target player takes an extra turn after this one.", ci: ["U"] }),
      card("Thassa's Oracle", { ci: ["U"] }),
      card("Demonic Consultation", { ci: ["B"] }),
    ].map((c) => [c.name.toLowerCase(), c])
  );
  const cards = ["Sol Ring", "Mana Crypt", "Swords to Plowshares", "Rhystic Study", "Time Warp", "Unknown Card"].map((n) => ({ q: 1, n }));
  const a = Decks.analyze(cards, [], "UB", lookup);
  assert.deepEqual(a.banned, ["Mana Crypt"]);
  assert.deepEqual(a.offColor, ["Swords to Plowshares"]);
  assert.deepEqual(a.gameChangers, ["Rhystic Study"]);
  assert.deepEqual(a.extraTurns, ["Time Warp"]);
  assert.deepEqual(a.notFound, ["Unknown Card"]);
  assert.equal(a.estimate.bracket, 3);

  const combo = Decks.analyze([{ q: 1, n: "Thassa's Oracle" }, { q: 1, n: "Demonic Consultation" }], [], "UB", lookup);
  assert.equal(combo.combos.length, 1);
  assert.equal(Decks.estimate({ gameChangers: [1, 2, 3, 4], mld: [], extraTurns: [], combos: [] }).bracket, 4);
  assert.equal(Decks.estimate({ gameChangers: [], mld: [], extraTurns: [], combos: [] }).bracket, 2);
  assert.equal(Decks.colorsOf(["Rhystic Study", "Demonic Consultation"], lookup), "UB");
});

const seat = (id, deck) => ({ playerId: id, name: id.toUpperCase(), deckId: deck, deckName: deck });
const match = (date, winnerSeat, eliminations, extra) => ({
  id: String(date),
  date,
  seats: [seat("a", "d1"), seat("b", "d2"), seat("c", null)],
  winnerSeat,
  eliminations,
  firstSeat: 0,
  ...extra,
});

test("head to head, nemesis and seasons", () => {
  const ms = [
    match(Date.UTC(2026, 0, 10), 0, [{ seat: 1, by: 0, cause: "combat" }, { seat: 2, by: 0, cause: "combat" }]),
    match(Date.UTC(2026, 4, 10), 1, [{ seat: 0, by: 1, cause: "combat" }]),
    match(Date.UTC(2026, 4, 12), 0, [{ seat: 1, by: 0, cause: "poison" }]),
  ];
  const rows = Stats.headToHead(ms, "player");
  assert.deepEqual(rows.a.b, { games: 3, wins: 2, losses: 1, koGiven: 2, koTaken: 1 });
  assert.equal(Stats.topBy(rows.b, "koTaken").id, "a");
  const decks = Stats.headToHead(ms, "deck");
  assert.equal(decks.d1.d2.games, 3);
  assert.equal(decks.d1.null, undefined);

  assert.equal(Stats.seasonKey(Date.UTC(2026, 4, 10)), "2026-Q2");
  assert.deepEqual(Stats.seasons(ms, Date.UTC(2026, 9, 1)), ["2026-Q4", "2026-Q2", "2026-Q1"]);
  const q2 = Stats.awards(Stats.inSeason(ms, "2026-Q2"));
  assert.equal(q2.stats.games, 2);
  assert.equal(q2.standings.length, 3);
});

test("recap tells the story of a tracked game", () => {
  const say = (key, vars) => key + (vars ? JSON.stringify(vars) : "");
  const m = {
    seats: [seat("a", "Krenko"), seat("b", "Atraxa"), seat("c", null)],
    startingLife: 40,
    firstSeat: 0,
    winnerSeat: 0,
    winType: "last",
    rounds: 5,
    durationMin: 70,
    finalLife: [4, 0, 0],
    damage: [[0, 30, 10], [36, 0, 20], [0, 10, 0]],
    eliminations: [{ seat: 2, by: 0, cause: "combat", round: 3 }, { seat: 1, by: 0, cause: "combat", round: 5 }],
    notes: ["gg"],
    events: [
      { type: "life", seat: 0, delta: -36, source: 1, round: 2 },
      { type: "life", seat: 2, delta: -20, source: 1, round: 2 },
      { type: "elim", seat: 2, by: 0, cause: "combat", round: 3 },
      { type: "life", seat: 1, delta: -40, source: 0, round: 5 },
      { type: "elim", seat: 1, by: 0, cause: "combat", round: 5 },
    ],
  };
  const lines = recap(m, say);
  assert.ok(lines[0].startsWith("rc_intro"));
  assert.ok(lines.some((l) => l.startsWith("rc_swing") && l.includes('"r":"2"') && l.includes('"dmg":56')));
  assert.ok(lines.some((l) => l.startsWith("rc_firstOutBy")));
  assert.ok(lines.some((l) => l.startsWith("rc_comeback") && l.includes('"life":4')));
  assert.ok(lines.some((l) => l.startsWith("rc_kingmaker") && l.includes('"name":"B"')));
  assert.ok(lines.some((l) => l.startsWith("rc_winDeck")));
  assert.equal(lines[lines.length - 1], "📝 gg");
  assert.deepEqual(recap({ seats: m.seats, winnerSeat: null, events: [] }, say).slice(-1), ["rc_draw"]);
});

test("bookmarklet is valid JavaScript and its payload round-trips", () => {
  const b = Decks.bookmarklet("https://example.org/app/");
  assert.ok(b.startsWith("javascript:"));
  new Function(decodeURIComponent(b.slice("javascript:".length)));
  const frag = "#import=" + encodeURIComponent(JSON.stringify({ v: 1, id: "x-1", n: "Deck", c: [[1, "Cmd"]], m: [[2, "Forest"]] }));
  const d = Decks.fromFragment(frag);
  assert.deepEqual(d.commanders, ["Cmd"]);
  assert.deepEqual(d.cards, [{ q: 1, n: "Cmd" }, { q: 2, n: "Forest" }]);
  assert.equal(d.source.url, "https://moxfield.com/decks/x-1");
  assert.equal(Decks.fromFragment("#import=%7Bbroken"), null);
  assert.equal(Decks.fromFragment("#other"), null);
});

test("card lookups come from the local cache before Scryfall", async () => {
  const calls = [];
  global.fetch = async (url, opts) => {
    const names = JSON.parse(opts.body).identifiers.map((i) => i.name);
    calls.push(names);
    return { ok: true, json: async () => ({ data: names.filter((n) => n !== "Nope").map((name) => ({ name, color_identity: [], legalities: { commander: "legal" } })), not_found: names.includes("Nope") ? [{ name: "Nope" }] : [] }) };
  };
  const cache = {};
  const first = await Decks.fetchCards(["Sol Ring", "Forest", "Nope"], cache);
  assert.equal(first.fetched, 3);
  assert.deepEqual(first.notFound, ["Nope"]);
  assert.ok(cache["sol ring"]);
  const second = await Decks.fetchCards(["Sol Ring", "Forest"], cache);
  assert.equal(second.fetched, 0);
  assert.equal(calls.length, 1);
  assert.equal(second.found.size, 2);
  delete global.fetch;
});

test("names are normalized the way Scryfall spells them", () => {
  assert.equal(Decks.normalizeName("Thassa’s Oracle"), "Thassa's Oracle");
  assert.equal(Decks.normalizeName("Fire/Ice"), "Fire // Ice");
  assert.equal(Decks.normalizeName("Fire / Ice"), "Fire // Ice");
  assert.equal(Decks.normalizeName("A-Teferi, Time Raveler"), "Teferi, Time Raveler");
  assert.equal(Decks.normalizeName("Ach! Hans, Run!"), "Ach! Hans, Run!");
  assert.deepEqual(Decks.parseList("1 Fire/Ice\n1 Thassa’s Oracle").cards.map((c) => c.n), ["Fire // Ice", "Thassa's Oracle"]);
});

test("replaceName fixes a line and keeps its count and the rest of the list", () => {
  const list = "Commander\n1 Atraxa Praetors Voice\n\nDeck\n2x Sol Rign (CMM) 1\n1 Forest";
  const out = Decks.replaceName(Decks.replaceName(list, "Sol Rign", "Sol Ring"), "Atraxa Praetors Voice", "Atraxa, Praetors' Voice");
  assert.equal(out, "Commander\n1 Atraxa, Praetors' Voice\n\nDeck\n2x Sol Ring\n1 Forest");
});

test("kept-as-is cards are not errors but lower confidence in the bracket", () => {
  const lookup = new Map([["sol ring", { name: "Sol Ring", type: "", text: "", ci: [], legal: "legal", gc: false }]]);
  const cards = [{ q: 1, n: "Sol Ring" }, { q: 1, n: "My Custom Card" }, { q: 1, n: "Sol Rign" }];
  const a = Decks.analyze(cards, [], "", lookup, ["my custom card"]);
  assert.deepEqual(a.notFound, ["Sol Rign"]);
  assert.deepEqual(a.custom, ["My Custom Card"]);
  assert.ok(a.estimate.reasons.some((r) => r.key === "br_unchecked" && r.n === 2));
});

test("suggestions come from Scryfall's fuzzy search and are cached", async () => {
  global.fetch = async (url) => {
    const q = new URL(url).searchParams.get("fuzzy");
    if (q === "Sol Rign") return { ok: true, json: async () => ({ name: "Sol Ring", color_identity: [], legalities: { commander: "legal" } }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const cache = {};
  const sug = await Decks.suggest(["Sol Rign", "Totally Made Up"], cache);
  assert.equal(sug["Sol Rign"].name, "Sol Ring");
  assert.equal(sug["Totally Made Up"], undefined);
  assert.ok(cache["sol ring"]);
  delete global.fetch;
});

test("card keys ignore hyphen styles, so a 'fix' can't loop", () => {
  assert.equal(Decks.cardKey("Human–Time Lord Meta-Crisis"), Decks.cardKey("Human-Time Lord Meta-Crisis"));
  assert.equal(Decks.cardKey("Thassa’s ORACLE"), "thassa's oracle");
});

test("planes and other non-deck cards are listed apart and not judged", () => {
  const card = (name, type, legal) => [Decks.cardKey(name), { name, type, text: "", ci: [], legal: legal || "legal", gc: false }];
  const lookup = new Map([card("Bad Wolf Bay", "Plane — Earth", "not_legal"), card("Jace Beleren", "Legendary Planeswalker — Jace"), card("Sol Ring", "Artifact")]);
  const a = Decks.analyze([{ q: 1, n: "Bad Wolf Bay" }, { q: 1, n: "Jace Beleren" }, { q: 1, n: "Sol Ring" }], [], "", lookup);
  assert.deepEqual(a.extra, ["Bad Wolf Bay"]);
  assert.deepEqual(a.banned, []);
  assert.equal(a.total, 2);
});

test("profile sync payload is validated", () => {
  const got = Decks.fromSync({ v: 2, user: "nati", decks: [{ id: "a1", n: "One", c: [[1, "Cmd"]], m: [[1, "X"]] }, { id: "bad id!", n: "", c: [], m: [] }, null] });
  assert.equal(got.user, "nati");
  assert.equal(got.decks.length, 1);
  assert.equal(got.decks[0].source.id, "a1");
  assert.equal(Decks.fromSync({ decks: [] }), null);
  assert.equal(Decks.fromSync("nope"), null);
});

test("username sync reads every page, then each deck, and reports failures", async () => {
  const calls = [];
  global.fetch = async (url) => {
    calls.push(url);
    const ok = (data) => ({ ok: true, status: 200, json: async () => data });
    if (url.includes("/v2/decks/search?") && new URL(url).searchParams.get("authorUserNames") === "nati") {
      const page = Number(new URL(url).searchParams.get("pageNumber"));
      return ok({
        totalPages: 2,
        data: page === 1 ? [{ publicId: "a", name: "Alpha", createdByUser: { userName: "Nati" } }, { publicId: "z", name: "Someone else's", createdByUser: { userName: "natix" } }] : [{ publicId: "b", name: "Beta" }],
      });
    }
    if (url.endsWith("/decks/all/a")) return ok({ name: "Alpha", boards: { commanders: { cards: { x: { quantity: 1, card: { name: "Cmd A" } } } }, mainboard: { cards: { y: { quantity: 2, card: { name: "Forest" } } } } } });
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const progress = [];
  const got = await Decks.syncUser("nati", (k, n) => progress.push(`${k}/${n}`));
  assert.equal(got.user, "nati");
  assert.deepEqual(got.decks.map((d) => d.name), ["Alpha"]);
  assert.deepEqual(got.decks[0].commanders, ["Cmd A"]);
  assert.deepEqual(got.failed, ["Beta"]);
  assert.deepEqual(progress, ["1/2", "2/2"]);
  assert.equal(calls.filter((u) => u.includes("pageNumber")).length, 2);

  global.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
  await assert.rejects(Decks.syncUser("nobody"), /noDecks/);
  global.fetch = async () => ({ ok: false, status: 403, json: async () => ({}) });
  await assert.rejects(Decks.syncUser("nati"), /blocked/);
  delete global.fetch;
});

test("reads the iPhone Shortcut's copied text", () => {
  const deck = (id, name, author, cmd) =>
    JSON.stringify({ publicId: id, name, createdByUser: { userName: author }, boards: { commanders: { cards: { a: { quantity: 1, card: { name: cmd } } } }, mainboard: { cards: { b: { quantity: 30, card: { name: "Forest" } } } } } });
  const text = ["CT-MOXFIELD-1 Salbucha", deck("d1", "Lumra Lands", "Salbucha", "Lumra, Bellow of the Woods"), deck("d2", "Not mine", "someoneelse", "X"), "{broken", deck("d3", "Doctor", "salbucha", "The Tenth Doctor")].join("\n@@CT@@\n");
  const got = Decks.fromShortcutText(text);
  assert.equal(got.user, "Salbucha");
  assert.deepEqual(got.decks.map((d) => d.name), ["Lumra Lands", "Doctor"]);
  assert.deepEqual(got.decks[0].commanders, ["Lumra, Bellow of the Woods"]);
  assert.equal(got.decks[0].cards.find((c) => c.n === "Forest").q, 30);
  assert.equal(got.decks[1].source.url, "https://moxfield.com/decks/d3");
  assert.deepEqual(got.failed, ["?"]);
  assert.equal(Decks.fromShortcutText("hello"), null);

  // Real output from a Shortcut whose loop copied the search entries instead
  // of the decks, with an empty username header.
  const entry = (id) => JSON.stringify({ id: "x", publicId: id, name: "Deck", createdByUser: { userName: "sugisan" }, mainboardCount: 100, commanders: [] });
  const bad = ["CT-MOXFIELD-1 ", entry("a"), entry("b"), "all", "all"].join("@@CT@@");
  assert.deepEqual(Decks.fromShortcutText(bad), { error: "listOnly", count: 2 });
  const noUser = ["CT-MOXFIELD-1", deck("d1", "Lumra Lands", "Salbucha", "Lumra, Bellow of the Woods")].join("@@CT@@");
  assert.equal(Decks.fromShortcutText(noUser).decks.length, 1);
});
