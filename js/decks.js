// Deck tools: decklist parsing, Moxfield import, Scryfall lookups and the
// deck check (banlist, color identity, Game Changers, estimated bracket).
// Everything here is an estimate to start a Rule 0 talk, never a verdict.
(function (root) {
  "use strict";
  const CT = (root.CT = root.CT || {});

  const SCRYFALL = "https://api.scryfall.com";
  const MOXFIELD_API = "https://api2.moxfield.com/v3/decks/all/";

  // ---------- Decklist text ----------

  const COMMANDER_HEADER = /^(commanders?|command zone)$/i;
  const SKIP_HEADER = /^(sideboard|maybeboard|maybe|considering|tokens?|attractions?|stickers?|companions?)$/i;

  function cleanName(raw) {
    return raw
      .replace(/\s*\*[A-Z]+\*/gi, "") // *F*, *CMDR*, *E*
      .replace(/\s*\[[^\]]*\]/g, "") // [Ramp], [Commander{top}]
      .replace(/\s*\^[^^]*\^/g, "") // ^Have,#37d67a^
      .replace(/\s+\([A-Za-z0-9]{2,6}\)(?:\s+\S+)?\s*$/, "") // (CMM) 400
      .replace(/\s+/g, " ")
      .trim();
  }

  // Accepts the text export of Moxfield, Archidekt, MTGO/Arena and plain lists.
  function parseList(text) {
    const byName = new Map();
    const commanders = [];
    let section = "main";
    for (let line of String(text || "").split(/\r?\n/)) {
      line = line.trim();
      if (!line) continue;
      const m = line.match(/^(\d+)\s*x?\s+(.+)$/i);
      const isHeader = !m && (/^\/\//.test(line) || /:$/.test(line) || /\(\d+\)$/.test(line) || COMMANDER_HEADER.test(line) || SKIP_HEADER.test(line) || /^(deck|main ?deck|mainboard)$/i.test(line));
      if (isHeader) {
        const h = line.replace(/^\/\/\s*/, "").replace(/:$/, "").replace(/\s*\(\d+\)$/, "").trim();
        section = COMMANDER_HEADER.test(h) ? "commander" : SKIP_HEADER.test(h) ? "skip" : "main";
        continue;
      }
      if (section === "skip") continue;
      const qty = m ? Number(m[1]) : 1;
      const rawName = m ? m[2] : line;
      const tagged = /\*CMDR\*/i.test(rawName) || /\[[^\]]*commander[^\]]*\]/i.test(rawName);
      const name = cleanName(rawName);
      if (!name) continue;
      if ((section === "commander" || tagged) && !commanders.includes(name)) commanders.push(name);
      const key = name.toLowerCase();
      const prev = byName.get(key);
      if (prev) prev.q += qty;
      else byName.set(key, { q: qty, n: name });
    }
    return { cards: [...byName.values()], commanders };
  }

  function toText(cards, commanders) {
    const cmd = new Set((commanders || []).map((c) => c.toLowerCase()));
    const head = cards.filter((c) => cmd.has(c.n.toLowerCase()));
    const rest = cards.filter((c) => !cmd.has(c.n.toLowerCase()));
    const line = (c) => `${c.q} ${c.n}`;
    return (head.length ? ["Commander", ...head.map(line), "", "Deck"] : []).concat(rest.map(line)).join("\n");
  }

  // Order-insensitive fingerprint, so re-sorting a list is not a new version.
  function fingerprint(cards) {
    return cards
      .map((c) => `${c.q} ${c.n.toLowerCase()}`)
      .sort()
      .join("|");
  }

  // ---------- Moxfield ----------

  function moxfieldId(input) {
    const s = String(input || "").trim();
    const m = s.match(/moxfield\.com\/decks\/([\w-]+)/i);
    if (m) return m[1];
    return /^[\w-]{8,}$/.test(s) ? s : null;
  }

  // Handles both the v3 shape (boards.x.cards) and the older v2 shape (x).
  function fromMoxfield(data) {
    const boards = data.boards || {};
    const board = (name) => {
      const b = boards[name] ? boards[name].cards : data[name];
      return b ? Object.values(b) : [];
    };
    const toCards = (entries) =>
      entries.map((e) => ({ q: e.quantity || 1, n: (e.card && e.card.name) || e.name })).filter((c) => c.n);
    const commanders = toCards(board("commanders"));
    const main = toCards(board("mainboard"));
    return { name: data.name || "", commanders: commanders.map((c) => c.n), cards: [...commanders, ...main] };
  }

  // Moxfield has no official public API and its Cloudflare protection blocks
  // browsers, so a direct call usually fails. The reliable route is a small
  // proxy that fetches server-side and answers GET {proxy}/moxfield/decks/{id}
  // (the same contract as Mulligan's proxy-server.py; see proxy/ in this repo).
  async function importMoxfield(input, proxy) {
    const id = moxfieldId(input);
    if (!id) throw new Error("badUrl");
    const urls = [];
    if (proxy) urls.push(proxy.replace(/\/+$/, "") + "/moxfield/decks/" + encodeURIComponent(id));
    urls.push(MOXFIELD_API + encodeURIComponent(id));
    let notFound = false;
    for (const url of urls) {
      try {
        const r = await fetch(url, { headers: { Accept: "application/json" } });
        if (r.status === 404) notFound = true;
        if (!r.ok) continue;
        const parsed = fromMoxfield(await r.json());
        if (!parsed.cards.length) throw new Error("empty");
        return { ...parsed, source: { type: "moxfield", id, url: "https://moxfield.com/decks/" + id } };
      } catch (e) {
        if (e.message === "empty") throw e;
      }
    }
    throw new Error(notFound ? "notFound" : proxy ? "proxyFailed" : "blocked");
  }

  // ---------- Scryfall ----------

  function summarize(c) {
    const faces = c.card_faces || [];
    const imgs = c.image_uris || (faces[0] && faces[0].image_uris) || {};
    return {
      name: c.name,
      type: c.type_line || faces.map((f) => f.type_line).join(" // "),
      text: c.oracle_text || faces.map((f) => f.oracle_text || "").join("\n"),
      ci: c.color_identity || [],
      legal: c.legalities ? c.legalities.commander : null,
      gc: !!c.game_changer,
      art: imgs.art_crop || null,
    };
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // Resolves names in batches of 75 (Scryfall's limit), politely spaced.
  async function fetchCards(names) {
    const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
    const found = new Map();
    const notFound = [];
    for (let i = 0; i < unique.length; i += 75) {
      if (i) await wait(120);
      const batch = unique.slice(i, i + 75);
      const r = await fetch(SCRYFALL + "/cards/collection", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ identifiers: batch.map((name) => ({ name })) }),
      });
      if (!r.ok) throw new Error("scryfall");
      const j = await r.json();
      for (const c of j.data || []) {
        const s = summarize(c);
        found.set(c.name.toLowerCase(), s);
        for (const f of c.card_faces || []) found.set(f.name.toLowerCase(), s);
      }
      for (const nf of j.not_found || []) if (nf.name) notFound.push(nf.name);
    }
    return { found, notFound };
  }

  async function autocomplete(q) {
    const r = await fetch(`${SCRYFALL}/cards/autocomplete?q=${encodeURIComponent(q)}`);
    const j = await r.json();
    return j.data || [];
  }

  async function lookupCard(name) {
    const r = await fetch(`${SCRYFALL}/cards/named?exact=${encodeURIComponent(name)}`);
    if (!r.ok) return null;
    const s = summarize(await r.json());
    s.canLead = /Legendary.*Creature|Background/.test(s.type) || /can be your commander/i.test(s.text);
    return s;
  }

  // ---------- Deck check ----------

  const MLD = [
    "Armageddon", "Ravages of War", "Catastrophe", "Jokulhaups", "Obliterate", "Decree of Annihilation", "Ruination",
    "Wildfire", "Destructive Flow", "Sunder", "Boil", "Epicenter", "Global Ruin", "Impending Disaster", "Apocalypse",
    "Death Cloud", "Myojin of Infinite Rage", "Fall of the Thran", "Keldon Firebombers", "Winter Orb", "Static Orb",
    "Back to Basics", "Blood Moon", "Rising Waters", "Hokori, Dust Drinker", "Numot, the Devastator", "Tectonic Break",
    "Devastation", "Cataclysm", "Bend or Break", "Thoughts of Ruin", "Acid Rain", "Flashfires", "Burning of Xinye",
    "Wake of Destruction", "Desolation Angel", "Ravages of War", "Contamination", "Armageddon Clock",
  ];
  const MLD_TEXT = /destroy all (?:nonbasic )?lands|destroy all [^.]*\blands\b|each player sacrifices (?:all|half|[^.]*) lands|lands don't untap/i;
  const EXTRA_TURN = /takes? an extra turn|extra turn after this one/i;
  const TUTOR = /search your library for (?:a|an|up to (?:one|two)) (?![^.]*\bland\b)[^.]*card/i;

  // Well-known two-card combos; a partial list, flagged as such in the UI.
  const COMBOS = [
    ["Thassa's Oracle", "Demonic Consultation"],
    ["Thassa's Oracle", "Tainted Pact"],
    ["Laboratory Maniac", "Demonic Consultation"],
    ["Jace, Wielder of Mysteries", "Demonic Consultation"],
    ["Isochron Scepter", "Dramatic Reversal"],
    ["Kiki-Jiki, Mirror Breaker", "Zealous Conscripts"],
    ["Kiki-Jiki, Mirror Breaker", "Pestermite"],
    ["Kiki-Jiki, Mirror Breaker", "Deceiver Exarch"],
    ["Kiki-Jiki, Mirror Breaker", "Restoration Angel"],
    ["Kiki-Jiki, Mirror Breaker", "Felidar Guardian"],
    ["Splinter Twin", "Pestermite"],
    ["Splinter Twin", "Deceiver Exarch"],
    ["Saheeli Rai", "Felidar Guardian"],
    ["Heliod, Sun-Crowned", "Walking Ballista"],
    ["Mikaeus, the Unhallowed", "Triskelion"],
    ["Mikaeus, the Unhallowed", "Walking Ballista"],
    ["Exquisite Blood", "Sanguine Bond"],
    ["Exquisite Blood", "Vito, Thorn of the Dusk Rose"],
    ["Niv-Mizzet, Parun", "Curiosity"],
    ["Niv-Mizzet, Parun", "Ophidian Eye"],
    ["Niv-Mizzet, the Firemind", "Curiosity"],
    ["Basalt Monolith", "Rings of Brighthearth"],
    ["Basalt Monolith", "Power Artifact"],
    ["Grim Monolith", "Power Artifact"],
    ["Dualcaster Mage", "Twinflame"],
    ["Dualcaster Mage", "Heat Shimmer"],
    ["Peregrine Drake", "Deadeye Navigator"],
    ["Palinchron", "Deadeye Navigator"],
    ["Food Chain", "Squee, the Immortal"],
    ["Food Chain", "Eternal Scourge"],
    ["Food Chain", "Misthollow Griffin"],
    ["Worldgorger Dragon", "Animate Dead"],
    ["Bloodchief Ascension", "Mindcrank"],
    ["Duskmantle Guildmage", "Mindcrank"],
    ["Painter's Servant", "Grindstone"],
    ["Devoted Druid", "Vizier of Remedies"],
    ["Sword of the Meek", "Thopter Foundry"],
    ["Auriok Salvagers", "Lion's Eye Diamond"],
    ["Godo, Bandit Warlord", "Helm of the Host"],
    ["The Gitrog Monster", "Dakmor Salvage"],
    ["Kinnan, Bonder Prodigy", "Basalt Monolith"],
    ["Ad Nauseam", "Angel's Grace"],
    ["Underworld Breach", "Lion's Eye Diamond"],
  ];

  function lower(list) {
    return new Set(list.map((n) => n.toLowerCase()));
  }

  // cards: [{q, n}]; lookup: Map(lowercase name -> summary); colors: "WUBRG" subset or "".
  function analyze(cards, commanders, colors, lookup) {
    const has = lower(cards.map((c) => c.n).concat(commanders || []));
    const deckCi = colors ? colors.split("") : null;
    const out = { total: 0, notFound: [], banned: [], offColor: [], gameChangers: [], mld: [], extraTurns: [], tutors: [], combos: [] };
    const mldNames = lower(MLD);
    for (const { q, n } of cards) {
      out.total += q;
      const c = lookup.get(n.toLowerCase());
      if (!c) {
        out.notFound.push(n);
        continue;
      }
      if (c.legal === "banned" || c.legal === "not_legal") out.banned.push(c.name);
      if (deckCi && c.ci.some((x) => !deckCi.includes(x))) out.offColor.push(c.name);
      if (c.gc) out.gameChangers.push(c.name);
      if (mldNames.has(c.name.toLowerCase()) || MLD_TEXT.test(c.text)) out.mld.push(c.name);
      if (EXTRA_TURN.test(c.text)) out.extraTurns.push(c.name);
      if (TUTOR.test(c.text)) out.tutors.push(c.name);
    }
    for (const [a, b] of COMBOS) if (has.has(a.toLowerCase()) && has.has(b.toLowerCase())) out.combos.push([a, b]);
    out.estimate = estimate(out);
    out.at = Date.now();
    return out;
  }

  // Bracket rules as published in the Commander Brackets beta:
  // 1–2 no Game Changers; 3 up to three, no mass land denial, no chained extra
  // turns, no early two-card combos; 4 anything legal; 5 is cEDH intent.
  function estimate(a) {
    const reasons = [];
    let b = 2;
    const gc = a.gameChangers.length;
    if (gc > 3) reasons.push({ key: "br_gcMany", n: gc });
    if (a.mld.length) reasons.push({ key: "br_mld" });
    if (a.extraTurns.length >= 2) reasons.push({ key: "br_extraTurns", n: a.extraTurns.length });
    if (reasons.length) b = 4;
    else if (gc || a.combos.length) {
      b = 3;
      if (gc) reasons.push({ key: "br_gcFew", n: gc });
    } else reasons.push({ key: "br_none" });
    if (a.combos.length) reasons.push({ key: "br_combos", n: a.combos.length });
    return { bracket: b, reasons };
  }

  function colorsOf(names, lookup) {
    const all = new Set();
    for (const n of names) {
      const c = lookup.get(n.toLowerCase());
      if (c) c.ci.forEach((x) => all.add(x));
    }
    return ["W", "U", "B", "R", "G"].filter((x) => all.has(x)).join("");
  }

  CT.Decks = { parseList, toText, fingerprint, moxfieldId, fromMoxfield, importMoxfield, fetchCards, autocomplete, lookupCard, analyze, estimate, colorsOf, COMBOS };
  if (typeof module !== "undefined") module.exports = CT.Decks;
})(typeof window !== "undefined" ? window : globalThis);
