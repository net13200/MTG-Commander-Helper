// Local persistence. The playgroup data and the game in progress are kept
// in separate keys so the live game can be written after every action.
(function (root) {
  "use strict";
  const CT = (root.CT = root.CT || {});

  const DATA_KEY = "ct.data.v1";
  const GAME_KEY = "ct.game.v1";

  function defaults() {
    const he = (navigator.language || "").toLowerCase().startsWith("he");
    return {
      players: [], // { id, name, color, avatar, guest }
      decks: [], // { id, ownerId, name, commanders: [], colors: "", list, bracket, art }
      matches: [],
      settings: { lang: he ? "he" : "en", keepAwake: true, dimInactive: false, turnTimer: false, showArt: true, startingLife: 40, moxProxy: "" },
    };
  }

  function read(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function write(key, value) {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  function normalize(raw) {
    const base = defaults();
    if (!raw || typeof raw !== "object") return base;
    return {
      players: Array.isArray(raw.players) ? raw.players : [],
      decks: Array.isArray(raw.decks) ? raw.decks : [],
      matches: Array.isArray(raw.matches) ? raw.matches : [],
      settings: { ...base.settings, ...(raw.settings || {}) },
    };
  }

  const data = normalize(read(DATA_KEY));

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  const Store = {
    data,
    uid,
    save() {
      return write(DATA_KEY, data);
    },
    loadGame() {
      return read(GAME_KEY);
    },
    saveGame(game) {
      return write(GAME_KEY, game);
    },
    player(id) {
      return data.players.find((p) => p.id === id) || null;
    },
    deck(id) {
      return data.decks.find((d) => d.id === id) || null;
    },
    decksOf(playerId) {
      return data.decks.filter((d) => d.ownerId === playerId);
    },
    // Folds a guest's history and decks into a real profile.
    mergeGuest(guestId, targetId) {
      const target = Store.player(targetId);
      if (!target || guestId === targetId) return;
      for (const m of data.matches) {
        for (const s of m.seats) {
          if (s.playerId === guestId) {
            s.playerId = targetId;
            s.name = target.name;
          }
        }
      }
      for (const d of data.decks) if (d.ownerId === guestId) d.ownerId = targetId;
      data.players = data.players.filter((p) => p.id !== guestId);
      Store.save();
    },
    replaceAll(raw) {
      const next = normalize(raw);
      Object.assign(data, next);
      Store.save();
    },
  };

  CT.Store = Store;
})(window);
