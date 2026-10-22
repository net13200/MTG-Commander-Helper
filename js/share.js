// Sharing players, decks and game history between phones without a server:
// the data is packed (gzip + base64url) into a link (#share=...) or a file,
// and merged on the receiving phone, matching people by name so the same
// person entered on two phones becomes one profile.
(function (root) {
  "use strict";
  const CT = (root.CT = root.CT || {});

  function toB64url(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function fromB64url(str) {
    const bin = atob(str.replace(/-/g, "+").replace(/_/g, "/"));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function pipe(bytes, stream) {
    return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
  }

  // "z" + gzip when the browser can compress, else "j" + plain JSON.
  async function encode(obj) {
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    if (root.CompressionStream) return "z" + toB64url(await pipe(bytes, new CompressionStream("gzip")));
    return "j" + toB64url(bytes);
  }

  async function decode(str) {
    const kind = str[0];
    let bytes = fromB64url(str.slice(1));
    if (kind === "z") bytes = await pipe(bytes, new DecompressionStream("gzip"));
    else if (kind !== "j") throw new Error("format");
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  const DECK_FIELDS = ["id", "ownerId", "name", "commanders", "colors", "list", "fp", "version", "bracket", "cmdIcons", "source", "known"];

  function pick(obj, fields) {
    const out = {};
    for (const f of fields) if (obj[f] !== undefined) out[f] = obj[f];
    return out;
  }

  // What gets sent: the chosen players, their decks (lists, not check results:
  // the receiver re-checks), and optionally the games they played in.
  function pack(data, playerIds, withHistory, from) {
    const ids = new Set(playerIds);
    return {
      app: "commander-tracker-share",
      v: 1,
      from: from || "",
      at: Date.now(),
      players: data.players.filter((p) => ids.has(p.id)).map((p) => pick(p, ["id", "name", "color", "avatar", "moxfieldUser"])),
      decks: data.decks.filter((d) => ids.has(d.ownerId)).map((d) => pick(d, DECK_FIELDS)),
      matches: withHistory ? data.matches.filter((m) => m.seats.some((s) => ids.has(s.playerId))) : [],
    };
  }

  function valid(share) {
    return share && share.app === "commander-tracker-share" && Array.isArray(share.players) && Array.isArray(share.decks);
  }

  const norm = (s) => String(s || "").trim().toLowerCase();

  // Merges a share into local data (mutates `data`). Returns what changed and
  // the ids of decks that are new or have a new list (to be re-checked).
  function merge(data, share, uid) {
    const res = { playersAdded: 0, playersMatched: 0, decksAdded: 0, decksUpdated: 0, matchesAdded: 0, touchedDecks: [] };
    const idMap = {};
    for (const p of share.players) {
      if (!p || !p.id || !p.name) continue;
      const local = data.players.find((x) => x.id === p.id) || data.players.find((x) => !x.guest && norm(x.name) === norm(p.name));
      if (local) {
        idMap[p.id] = local.id;
        local.guest = false;
        if (!local.moxfieldUser && p.moxfieldUser) local.moxfieldUser = p.moxfieldUser;
        res.playersMatched++;
      } else {
        data.players.push({ id: p.id, name: String(p.name).slice(0, 24), color: p.color || "#8d8d8d", avatar: p.avatar || "", moxfieldUser: p.moxfieldUser || "", guest: false });
        idMap[p.id] = p.id;
        res.playersAdded++;
      }
    }
    for (const d of share.decks) {
      const owner = d && idMap[d.ownerId];
      if (!owner || !d.id) continue;
      const local =
        data.decks.find((x) => x.id === d.id) ||
        data.decks.find((x) => x.ownerId === owner && d.source && x.source && x.source.id === d.source.id) ||
        data.decks.find((x) => x.ownerId === owner && norm(x.name) === norm(d.name));
      if (!local) {
        data.decks.push({ ...d, ownerId: owner, analysis: null, versions: d.list ? [{ v: d.version || 1, at: Date.now(), list: d.list }] : [], cmdArt: [] });
        res.decksAdded++;
        res.touchedDecks.push(d.id);
      } else if (d.fp && local.fp !== d.fp) {
        const version = (local.version || 1) + 1;
        Object.assign(local, { list: d.list, fp: d.fp, commanders: d.commanders, colors: d.colors || local.colors, source: d.source || local.source, analysis: null, version });
        local.versions = [...(local.versions || []), { v: version, at: Date.now(), list: d.list }].slice(-20);
        res.decksUpdated++;
        res.touchedDecks.push(local.id);
      }
    }
    const byName = (name) => data.players.find((x) => !x.guest && norm(x.name) === norm(name));
    for (const m of share.matches || []) {
      if (!m || !m.id || !Array.isArray(m.seats) || data.matches.some((x) => x.id === m.id)) continue;
      const seats = m.seats.map((s) => {
        const id = idMap[s.playerId] || (data.players.some((x) => x.id === s.playerId) ? s.playerId : (byName(s.name) || {}).id);
        return id ? { ...s, playerId: id } : s;
      });
      data.matches.push({ ...m, seats });
      res.matchesAdded++;
    }
    return res;
  }

  CT.Share = { encode, decode, pack, merge, valid };
  if (typeof module !== "undefined") module.exports = CT.Share;
})(typeof window !== "undefined" ? window : globalThis);
