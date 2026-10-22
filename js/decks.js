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

  // Fixes the spellings exports and keyboards commonly get wrong, so they
  // match Scryfall: curly quotes, "Fire/Ice" split cards, Arena "A-" names.
  function normalizeName(name) {
    return String(name || "")
      .replace(/[\u2018\u2019\u02BC\u0060\u00B4]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/^A-(?=[A-Z])/, "")
      .replace(/\s*\/{1,2}\s*/g, " // ")
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
      const name = normalizeName(cleanName(rawName));
      if (!name) continue;
      if ((section === "commander" || tagged) && !commanders.includes(name)) commanders.push(name);
      const key = name.toLowerCase();
      const prev = byName.get(key);
      if (prev) prev.q += qty;
      else byName.set(key, { q: qty, n: name });
    }
    return { cards: [...byName.values()], commanders };
  }

  // The key cards are matched by everywhere (lookups, cache, combos), so
  // cosmetic differences such as hyphen styles or case never cause a miss.
  function cardKey(name) {
    return normalizeName(name)
      .toLowerCase()
      .replace(/[\u2010-\u2015\u2212]/g, "-");
  }

  // Swaps one card name for another in a decklist, keeping each line's count.
  function replaceName(text, from, to) {
    const target = cardKey(from);
    return String(text || "")
      .split(/\r?\n/)
      .map((line) => {
        const m = line.trim().match(/^(\d+\s*x?\s+)?(.+)$/i);
        if (!m) return line;
        return cardKey(cleanName(m[2])) === target ? (m[1] || "") + to : line;
      })
      .join("\n");
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

  // Moxfield has no official public API, and it doesn't let other sites read
  // its decks (CORS plus Cloudflare), so this direct call is expected to fail
  // from the app. It is still tried in case that ever changes; the app then
  // falls back to the clipboard flow or the bookmarklet below.
  async function importMoxfield(input) {
    const id = moxfieldId(input);
    if (!id) throw new Error("badUrl");
    let r;
    try {
      r = await fetch(MOXFIELD_API + encodeURIComponent(id), { headers: { Accept: "application/json" } });
    } catch (e) {
      throw new Error("blocked");
    }
    if (r.status === 404) throw new Error("notFound");
    if (!r.ok) throw new Error("blocked");
    const parsed = fromMoxfield(await r.json());
    if (!parsed.cards.length) throw new Error("empty");
    return { ...parsed, source: { type: "moxfield", id, url: "https://moxfield.com/decks/" + id } };
  }

  // A bookmarklet runs on moxfield.com itself, where Moxfield's own API is
  // allowed. On a deck page it sends that deck; on a profile page
  // (moxfield.com/users/<name>) it sends all of that user's public decks. It
  // opens the app in a new tab right away and hands the decks over with
  // postMessage once fetched; if the tab can't open, a single deck goes in
  // the URL fragment instead (#import=..., never sent to a server).
  function bookmarklet(appUrl) {
    // Moxfield rate-limits quick bursts, so decks are read about one a second
    // with retries; progress shows on the Moxfield page and in the app tab.
    const code = String.raw`(async()=>{const A=${JSON.stringify(appUrl)},O=new URL(A).origin,S=t=>new Promise(r=>setTimeout(r,t));if(!location.hostname.endsWith("moxfield.com")){alert("Open a deck or your profile on moxfield.com first, then tap this bookmark.");return}const dm=location.pathname.match(/\/decks\/([\w-]+)/),um=location.pathname.match(/\/users\/([^\/?#]+)/);if(!dm&&!um){alert("Open a deck or your profile on moxfield.com first, then tap this bookmark.");return}const w=window.open(A+"#receive","_blank");const box=document.createElement("div");box.style.cssText="position:fixed;z-index:2147483647;left:50%;bottom:20px;transform:translateX(-50%);max-width:90vw;background:#111;color:#fff;padding:12px 18px;border-radius:12px;font:600 15px system-ui;box-shadow:0 4px 20px #0008";document.body.appendChild(box);const say=m=>{box.textContent="Commander Tracker: "+m};const tell=m=>{try{if(w)w.postMessage(m,O)}catch(e){}};const get=async u=>{for(let k=0;k<4;k++){let st=0;for(const c of["omit","include"]){try{const r=await fetch(u,{credentials:c});if(r.ok)return await r.json();st=r.status;if(st===404)return null;if(st===429)break}catch(e){}}await S(st===429?5000*(k+1):1500)}return null};const deck=async id=>{const d=await get("https://api2.moxfield.com/v3/decks/all/"+id);if(!d)return null;const b=d.boards||{};const g=n=>Object.values((b[n]&&b[n].cards)||d[n]||{}).map(e=>[e.quantity||1,(e.card&&e.card.name)||e.name]);return{id,n:d.name||"",c:g("commanders"),m:g("mainboard")}};let ids=[],names={},user=null;if(dm)ids=[dm[1]];else{user=decodeURIComponent(um[1]);say("finding decks…");for(let p=1;p<=10;p++){const l=await get("https://api2.moxfield.com/v2/users/"+encodeURIComponent(user)+"/decks?pageNumber="+p+"&pageSize=100");if(!l||!Array.isArray(l.data)||!l.data.length)break;l.data.forEach(x=>{if(x.publicId){ids.push(x.publicId);names[x.publicId]=x.name}});if(!l.totalPages||p>=l.totalPages)break;await S(1100)}if(!ids.length)ids=[...document.querySelectorAll('a[href*="/decks/"]')].map(a=>(a.getAttribute("href").match(/\/decks\/([\w-]+)/)||[])[1]).filter(x=>x&&!/^(public|personal|following|liked|search|bookmarks)$/.test(x))}ids=[...new Set(ids)].slice(0,150);if(!ids.length){say("no public decks found.");alert("No public decks found here.");if(w)w.close();return}const decks=[],failed=[];for(let i=0;i<ids.length;i++){say("reading deck "+(i+1)+" of "+ids.length+"…");tell({type:"ct-progress",k:i+1,n:ids.length});const d=await deck(ids[i]);if(d)decks.push(d);else failed.push(names[ids[i]]||ids[i]);if(i<ids.length-1)await S(1100)}if(!decks.length){say("Moxfield didn't return the decks.");alert("Moxfield didn't return the decks. Use More > Export > Copy plain text and paste it in Commander Tracker instead.");if(w)w.close();return}if(!w){const x=decks[0];location.href=A+"#import="+encodeURIComponent(JSON.stringify({v:1,id:x.id,n:x.n,c:x.c,m:x.m}));return}let ok=false;addEventListener("message",e=>{if(e.origin===O&&e.data&&e.data.type==="ct-ack")ok=true});for(let i=0;i<80&&!ok;i++){tell({type:"ct-decks",data:{v:2,user,decks,failed}});await S(500)}say(ok?"sent "+decks.length+" of "+ids.length+" decks"+(failed.length?". Couldn't read: "+failed.join(", "):"."):"the app tab didn't answer.");setTimeout(()=>box.remove(),ok&&!failed.length?6000:20000)})()`;
    return "javascript:" + encodeURIComponent(code).replace(/%2F/g, "/").replace(/%3A/g, ":");
  }

  function deckFromPayload(p) {
    if (!p || typeof p !== "object") return null;
    const toCards = (list) => (Array.isArray(list) ? list : []).filter((e) => Array.isArray(e) && e[1]).map(([q, n]) => ({ q: Number(q) || 1, n: String(n).slice(0, 200) }));
    const commanders = toCards(p.c);
    const cards = [...commanders, ...toCards(p.m)];
    if (!cards.length) return null;
    const id = typeof p.id === "string" && /^[\w-]+$/.test(p.id) ? p.id : null;
    return { name: String(p.n || "").slice(0, 80), commanders: commanders.map((c) => c.n), cards, source: id ? { type: "moxfield", id, url: "https://moxfield.com/decks/" + id } : null };
  }

  // Reads the #import= payload of a single deck.
  function fromFragment(hash) {
    const m = String(hash || "").match(/^#import=(.+)$/);
    if (!m) return null;
    try {
      return deckFromPayload(JSON.parse(decodeURIComponent(m[1])));
    } catch (e) {
      return null;
    }
  }

  // Reads the postMessage payload: { v: 2, user, decks: [...] }.
  function fromSync(data) {
    if (!data || !Array.isArray(data.decks)) return null;
    const decks = data.decks.slice(0, 100).map(deckFromPayload).filter(Boolean);
    if (!decks.length) return null;
    const failed = Array.isArray(data.failed) ? data.failed.slice(0, 100).map((x) => String(x).slice(0, 80)) : [];
    return { user: typeof data.user === "string" ? data.user.slice(0, 60) : null, decks, failed };
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

  // Resolves names from the local card cache first, then asks Scryfall for the
  // rest in batches of 75 (its limit), politely spaced. New cards are written
  // into `cache` (a plain object kept on the device) so checks work offline.
  async function fetchCards(names, cache) {
    cache = cache || {};
    const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
    const found = new Map();
    const notFound = [];
    const missing = [];
    for (const n of unique) {
      const hit = cache[cardKey(n)];
      if (hit) found.set(cardKey(n), hit);
      else missing.push(n);
    }
    for (let i = 0; i < missing.length; i += 75) {
      if (i) await wait(120);
      const batch = missing.slice(i, i + 75);
      const r = await fetch(SCRYFALL + "/cards/collection", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ identifiers: batch.map((name) => ({ name })) }),
      });
      if (!r.ok) throw new Error("scryfall");
      const j = await r.json();
      for (const c of j.data || []) {
        const s = summarize(c);
        for (const key of [c.name, ...(c.card_faces || []).map((f) => f.name)]) {
          found.set(cardKey(key), s);
          cache[cardKey(key)] = s;
        }
      }
      for (const nf of j.not_found || []) if (nf.name) notFound.push(nf.name);
    }
    return { found, notFound, fetched: missing.length };
  }

  // Closest Scryfall match for names it didn't recognize ("Did you mean…?").
  // Returns { name: suggestion summary }; matches are cached like any card.
  async function suggest(names, cache) {
    const out = {};
    for (const [i, name] of names.slice(0, 25).entries()) {
      if (i) await wait(110);
      try {
        const r = await fetch(`${SCRYFALL}/cards/named?fuzzy=${encodeURIComponent(name)}`);
        if (!r.ok) continue;
        const c = await r.json();
        const s = summarize(c);
        out[name] = s;
        if (cache) for (const key of [c.name, ...(c.card_faces || []).map((f) => f.name)]) cache[cardKey(key)] = s;
      } catch (e) {
        break; // offline: no suggestions this time
      }
    }
    return out;
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
    return new Set(list.map(cardKey));
  }

  // Planechase planes, Archenemy schemes and similar travel with some exports
  // but aren't part of the 100 cards, so they're listed apart and not judged.
  const NOT_IN_DECK = /\b(Plane|Phenomenon|Scheme|Attraction|Contraption|Stickers?|Dungeon)\b/;

  // cards: [{q, n}]; lookup: Map(lowercase name -> summary); colors: "WUBRG" subset or "".
  // known: names the owner chose to keep as they are (custom or proxy cards).
  function analyze(cards, commanders, colors, lookup, known) {
    const has = lower(cards.map((c) => c.n).concat(commanders || []));
    const deckCi = colors ? colors.split("") : null;
    const keep = lower(known || []);
    const out = { total: 0, extra: [], notFound: [], custom: [], banned: [], offColor: [], gameChangers: [], mld: [], extraTurns: [], tutors: [], combos: [] };
    const mldNames = lower(MLD);
    for (const { q, n } of cards) {
      const c = lookup.get(cardKey(n));
      if (c && NOT_IN_DECK.test(c.type)) {
        out.extra.push(c.name);
        continue;
      }
      out.total += q;
      if (!c) {
        (keep.has(cardKey(n)) ? out.custom : out.notFound).push(n);
        continue;
      }
      if (c.legal === "banned" || c.legal === "not_legal") out.banned.push(c.name);
      if (deckCi && c.ci.some((x) => !deckCi.includes(x))) out.offColor.push(c.name);
      if (c.gc) out.gameChangers.push(c.name);
      if (mldNames.has(cardKey(c.name)) || MLD_TEXT.test(c.text)) out.mld.push(c.name);
      if (EXTRA_TURN.test(c.text)) out.extraTurns.push(c.name);
      if (TUTOR.test(c.text)) out.tutors.push(c.name);
    }
    for (const [a, b] of COMBOS) if (has.has(cardKey(a)) && has.has(cardKey(b))) out.combos.push([a, b]);
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
    const unchecked = (a.notFound || []).length + (a.custom || []).length;
    if (unchecked) reasons.push({ key: "br_unchecked", n: unchecked });
    return { bracket: b, reasons };
  }

  function colorsOf(names, lookup) {
    const all = new Set();
    for (const n of names) {
      const c = lookup.get(cardKey(n));
      if (c) c.ci.forEach((x) => all.add(x));
    }
    return ["W", "U", "B", "R", "G"].filter((x) => all.has(x)).join("");
  }

  CT.Decks = { parseList, normalizeName, cardKey, fromSync, replaceName, suggest, toText, fingerprint, moxfieldId, fromMoxfield, importMoxfield, bookmarklet, fromFragment, fetchCards, autocomplete, lookupCard, analyze, estimate, colorsOf, COMBOS };
  if (typeof module !== "undefined") module.exports = CT.Decks;
})(typeof window !== "undefined" ? window : globalThis);
