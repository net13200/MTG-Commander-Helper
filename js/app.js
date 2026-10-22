(function () {
  "use strict";
  const { Store, Game, Stats, I18n, Decks, Recap, Sound } = window.CT;
  const S = Store.data;
  const t = I18n.t;
  const $ = (sel) => document.querySelector(sel);
  const app = $("#app");
  const modalRoot = $("#modal");

  const COLORS = ["#e5484d", "#f76b15", "#ffc53d", "#46a758", "#12a594", "#0090ff", "#6e56cf", "#d6409f", "#8d8d8d", "#ad7f58"];
  const AVATARS = ["🐉", "🧙", "🦉", "🐺", "🦁", "🐙", "🌲", "🔥", "💀", "⚡", "🌊", "🌞", "🦇", "🐍", "🛡️", "👑", "🍄", "🤖"];
  const MANA = ["W", "U", "B", "R", "G"];
  const CAUSES = ["combat", "commander", "poison", "altwin", "concede", "other"];
  const WIN_TYPES = ["last", "alt", "concede", "draw"];
  const QUICK_COUNTERS = ["energy", "experience", "rad"];
  const NOTE_TAGS = ["combo", "swing", "comeback", "kingmaker", "misplay", "funny"];
  const BATCH_MS = 1500;
  const ATTRIB_MS = 8000;

  const ui = { cmdBy: {}, edit: null, view: "home", params: {}, setup: null, manual: null, panel: null, attrib: null, swapPick: null, elim: null, end: null, deck: null, riv: { kind: "player", id: null }, season: null, statsSeason: "" };
  let game = Store.loadGame();
  const pending = new Map(); // batch key -> { ev, timer }
  let confirmCb = null;
  let attribTimer = null;
  let wakeLock = null;

  // ---------- Helpers ----------

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
  function fmtDelta(d) {
    return d > 0 ? "+" + d : "−" + Math.abs(d);
  }
  function fmtClock(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
  }
  function locale() {
    return S.settings.lang === "he" ? "he-IL" : "en-GB";
  }
  function fmtDate(ts) {
    return new Date(ts).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" });
  }
  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
  }
  function pct(x) {
    return Math.round(x * 100) + "%";
  }
  function avatar(p) {
    return `<span class="avatar" style="--c:${esc(p.color)}">${esc(p.avatar || (p.name || "?").slice(0, 1))}</span>`;
  }
  function pips(colors) {
    const list = (colors || "").split("").filter((c) => MANA.includes(c));
    return list.length ? `<span class="pips">${list.map((c) => `<i class="pip pip-${c}"></i>`).join("")}</span>` : "";
  }
  function cmdNames(seat) {
    return seat.commanders && seat.commanders.length ? seat.commanders : [I18n.raw("commander")];
  }
  function counterLabel(name) {
    return QUICK_COUNTERS.includes(name) ? t("ctr_" + name) : esc(name);
  }
  function podNames(setup) {
    return setup.seats.map((s) => s.name).join(" · ");
  }
  function isLandscape() {
    return window.innerWidth > window.innerHeight * 1.15;
  }
  function random(n) {
    return Math.floor(Math.random() * n);
  }
  function clampLife(v) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? Math.min(999, Math.max(1, n)) : 40;
  }

  function toast(html) {
    const el = $("#toast");
    el.innerHTML = html;
    el.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove("show"), 2400);
  }

  function openModal(html, cls) {
    modalRoot.innerHTML = `<div class="modal-back" data-action="closeModal"></div><div class="modal ${cls || ""}" role="dialog" aria-modal="true">${html}</div>`;
    modalRoot.hidden = false;
  }
  function closeModal() {
    modalRoot.hidden = true;
    modalRoot.innerHTML = "";
  }
  function confirmModal(text, onYes, yesLabel) {
    confirmCb = onYes;
    openModal(
      `<p class="confirm-text">${text}</p>
       <div class="actions"><button class="btn" data-action="closeModal">${t("cancel")}</button>
       <button class="btn danger" data-action="confirmYes">${yesLabel || t("confirm")}</button></div>`,
      "small"
    );
  }

  // ---------- Live game: event log, batching and persistence ----------

  function pendingEvents() {
    return [...pending.values()].map((p) => p.ev);
  }
  function liveState() {
    return Game.derive(game.setup, game.events.concat(pendingEvents()));
  }
  function persist() {
    if (!game) return;
    game.pending = pendingEvents();
    Store.saveGame(game);
  }
  function push(base) {
    const st = Game.derive(game.setup, game.events);
    const ev = { ...base, id: Store.uid(), t: Date.now(), round: st.round };
    game.events.push(ev);
    return ev;
  }

  // Taps on the same counter are merged into one log entry once input pauses.
  function queue(base, d) {
    const key = [base.type, base.seat, base.from, base.idx, base.name, base.by].join("|");
    let p = pending.get(key);
    if (!p) {
      p = { ev: { ...base, delta: 0 } };
      pending.set(key, p);
    }
    p.ev.delta += d;
    // Ask "from whom?" as soon as life starts dropping, not after the pause.
    if (base.type === "life") {
      if (p.ev.delta < 0 && !p.ev.chosen && liveState().alive.some((x) => x !== base.seat)) {
        clearTimeout(attribTimer);
        ui.attrib = { seat: base.seat, key };
      } else if (ui.attrib && ui.attrib.key === key) ui.attrib = null;
    }
    clearTimeout(p.timer);
    p.timer = setTimeout(() => commitPending(key), BATCH_MS);
    persist();
    render();
  }

  function commitPending(key, quiet) {
    const p = pending.get(key);
    if (!p) return;
    clearTimeout(p.timer);
    pending.delete(key);
    if (p.ev.delta) {
      const ev = push(p.ev);
      if (ev.type === "life") settleSource(ev, key, quiet);
    } else if (ui.attrib && ui.attrib.key === key) ui.attrib = null;
    persist();
    if (!quiet) render();
  }

  function flushAll() {
    for (const key of [...pending.keys()]) commitPending(key, true);
  }

  function dispatch(base) {
    flushAll();
    ui.attrib = null;
    const ev = push(base);
    persist();
    render();
    return ev;
  }

  // Once a life loss is committed: in 1v1 the opponent is the default source;
  // otherwise it stays unknown. The strip lingers a few seconds so the source
  // (or "paid life") can still be picked or changed.
  function settleSource(ev, key, quiet) {
    const chosen = ev.chosen;
    delete ev.chosen;
    const strip = ui.attrib && ui.attrib.key === key;
    if (ev.delta >= 0) {
      if (strip) ui.attrib = null;
      return;
    }
    const others = Game.derive(game.setup, game.events).alive.filter((s) => s !== ev.seat);
    if (!chosen && ev.source == null && others.length === 1) ev.source = others[0];
    if (!strip) return;
    if (chosen || quiet || !others.length) {
      ui.attrib = null;
      return;
    }
    ui.attrib = { seat: ev.seat, evId: ev.id };
    clearTimeout(attribTimer);
    attribTimer = setTimeout(() => {
      ui.attrib = null;
      if (ui.view === "game") render();
    }, ATTRIB_MS);
  }

  function newGame(setup) {
    pending.clear();
    game = { id: Store.uid(), setup, events: [], pending: [] };
    persist();
  }

  function restoreGame() {
    if (!game) return;
    for (const ev of game.pending || []) {
      if (ev.delta) game.events.push({ ...ev, id: Store.uid(), t: Date.now(), round: Game.derive(game.setup, game.events).round });
    }
    game.pending = [];
    Store.saveGame(game);
  }

  function checkEnd() {
    const st = liveState();
    if (st.alive.length <= 1) openEnd();
  }

  function describe(ev, seats) {
    const nm = (i) => (seats[i] ? seats[i].name : "?");
    const name = nm(ev.seat);
    switch (ev.type) {
      case "life":
        return t("ev_life", { name, d: fmtDelta(ev.delta) }) + (ev.source === ev.seat ? t("ev_paid") : Number.isInteger(ev.source) ? t("ev_from", { name: nm(ev.source) }) : "");
      case "cmd":
        return (
          t("ev_cmd", { name, d: fmtDelta(ev.delta), src: nm(ev.from), cmd: cmdNames(seats[ev.from] || {})[ev.idx] || "" }) +
          (Number.isInteger(ev.by) && ev.by !== ev.from ? t("ev_controlled", { name: nm(ev.by) }) : "")
        );
      case "poison":
        return t("ev_poison", { name, d: fmtDelta(ev.delta) });
      case "tax":
        return t("ev_tax", { name, cmd: cmdNames(seats[ev.seat] || {})[ev.idx] || "", d: fmtDelta(ev.delta) });
      case "counter":
        return t("ev_counter", { name, d: fmtDelta(ev.delta), counter: QUICK_COUNTERS.includes(ev.name) ? I18n.raw("ctr_" + ev.name) : ev.name });
      case "flag":
        return t(ev.value ? "ev_flagOn" : "ev_flagOff", { name, flag: I18n.raw(ev.flag) });
      case "token":
        return t(Number.isInteger(ev.seat) ? "ev_token" : "ev_tokenNone", { name, token: I18n.raw(ev.token) });
      case "elim":
        return t("ev_elim", { name, cause: I18n.raw("cause_" + ev.cause) }) + (Number.isInteger(ev.by) && ev.by !== ev.seat ? t("ev_by", { name: nm(ev.by) }) : "");
      case "turn":
        return t("ev_turn", { name: nm(ev.to) });
      case "note":
        return "📝 " + esc(ev.text);
    }
    return esc(ev.type);
  }

  // ---------- Views ----------

  function header(title, back) {
    const arrow = I18n.dir() === "rtl" ? "→" : "←";
    return `<header class="bar"><button class="icon-btn" data-action="nav" data-to="${back || "home"}" aria-label="${t("back")}">${arrow}</button><h1>${title}</h1></header>`;
  }

  function homeView() {
    const resume = game
      ? `<button class="btn primary big" data-action="nav" data-to="game">${t("resumeGame")}<small>${esc(podNames(game.setup))}</small></button>`
      : "";
    return `<div class="page home">
      <div class="hero"><img src="icon.svg" class="logo" alt=""><h1>${t("appName")}</h1><p class="muted">${t("tagline")}</p></div>
      ${resume}
      <button class="btn ${game ? "" : "primary"} big" data-action="newSetup">${t("newGame")}</button>
      <div class="menu-grid">
        <button class="menu-card" data-action="nav" data-to="players"><b>👥</b><span>${t("playersDecks")}</span></button>
        <button class="menu-card" data-action="nav" data-to="history"><b>📜</b><span>${t("history")}</span></button>
        <button class="menu-card" data-action="nav" data-to="stats"><b>📊</b><span>${t("stats")}</span></button>
        <button class="menu-card" data-action="nav" data-to="rivalries"><b>⚔️</b><span>${t("rivalries")}</span></button>
        <button class="menu-card" data-action="nav" data-to="seasons"><b>🏆</b><span>${t("seasons")}</span></button>
        <button class="menu-card" data-action="newManual"><b>✍️</b><span>${t("logPastGame")}</span></button>
        <button class="menu-card" data-action="nav" data-to="settings"><b>⚙️</b><span>${t("settings")}</span></button>
      </div>
      <p class="legal">${t("fanContent")}</p>
    </div>`;
  }

  function podChips(selected, action) {
    const ids = selected.map((s) => s.playerId);
    const people = [...S.players.filter((p) => !p.guest), ...S.players.filter((p) => p.guest)];
    if (!people.length) return `<p class="muted">${t("noPlayersYet")}</p>`;
    return `<div class="chips">${people
      .map(
        (p) =>
          `<button class="chip ${ids.includes(p.id) ? "on" : ""}" data-action="${action}" data-id="${p.id}" style="--c:${esc(p.color)}">${avatar(p)}${esc(p.name)}${p.guest ? `<small>${t("guest")}</small>` : ""}</button>`
      )
      .join("")}</div>`;
  }

  function deckOptions(playerId, selectedId) {
    return `<option value="">${t("noDeck")}</option>${Store.decksOf(playerId)
      .map((d) => `<option value="${d.id}" ${d.id === selectedId ? "selected" : ""}>${esc(d.name)}</option>`)
      .join("")}`;
  }

  function seatMap(seats) {
    const n = seats.length;
    if (n < Game.MIN_PLAYERS) return `<div class="seatmap empty">${t("pickPlayersHint")}</div>`;
    const L = Game.layout(n, false);
    return `<div class="seatmap" style="grid-template-rows:${L.rows};grid-template-columns:${L.cols}">${seats
      .map((s, i) => {
        const p = Store.player(s.playerId);
        const [row, col, rot] = L.seats[i];
        return `<button class="seat ${ui.swapPick === i ? "picked" : ""}" style="grid-row:${row};grid-column:${col};--c:${esc(p.color)}" data-action="seatTap" data-seat="${i}"><span class="seat-in r${rot}">${avatar(p)}<span>${esc(p.name)}</span></span></button>`;
      })
      .join("")}</div>`;
  }

  function setupView() {
    const su = ui.setup;
    const n = su.seats.length;
    const decks = su.quick
      ? ""
      : su.seats
          .map((s, i) => {
            const p = Store.player(s.playerId);
            return `<label class="row">${avatar(p)}<span class="grow">${esc(p.name)}</span><select data-change="seatDeck" data-seat="${i}">${deckOptions(p.id, s.deckId)}</select></label>`;
          })
          .join("");
    const firstOpts = su.seats
      .map((s, i) => `<option value="${i}" ${String(su.first) === String(i) ? "selected" : ""}>${esc(Store.player(s.playerId).name)}</option>`)
      .join("");
    return `${header(t("newGame"))}
    <div class="page">
      <section><h2>${t("whoPlays")} <small class="muted">${n}/${Game.MAX_PLAYERS}</small></h2>
        ${podChips(su.seats, "togglePod")}
        <form class="inline" data-submit="addGuest"><input id="guestName" placeholder="${t("guestName")}" maxlength="24" autocomplete="off"><button class="btn">${t("addGuest")}</button></form>
      </section>
      <section><h2>${t("seating")}</h2><p class="muted small">${t("seatHint")}</p>${seatMap(su.seats)}</section>
      ${n ? `<section><h2>${t("decks")}</h2>
        <label class="row"><input type="checkbox" data-change="quick" ${su.quick ? "checked" : ""}><span>${t("quickGame")}</span></label>
        ${decks}${balanceWarnings(su).map((w) => `<p class="warn">⚖️ ${w}</p>`).join("")}</section>` : ""}
      <section class="two">
        <label class="field"><span>${t("startingLife")}</span><input type="number" inputmode="numeric" min="1" max="999" value="${su.startingLife}" data-change="startLife"></label>
        <label class="field"><span>${t("firstPlayer")}</span><select data-change="first"><option value="random">🎲 ${t("random")}</option>${firstOpts}</select></label>
      </section>
      <button class="btn primary big" data-action="startGame" ${n < Game.MIN_PLAYERS ? "disabled" : ""}>${t("startGame")}</button>
    </div>`;
  }

  function pendingLife(seat) {
    let d = 0;
    for (const { ev } of pending.values()) {
      if (ev.seat !== seat) continue;
      if (ev.type === "life") d += ev.delta;
      if (ev.type === "cmd") d -= ev.delta;
    }
    return d;
  }

  function tileHtml(seat, i, st, pos) {
    const p = st.players[i];
    const rot = pos[2];
    const badges = [];
    if (st.monarch === i) badges.push(`<span class="badge" title="${t("monarch")}">👑</span>`);
    if (st.initiative === i) badges.push(`<span class="badge" title="${t("initiative")}">🏰</span>`);
    if (p.poison) badges.push(`<span class="badge poison">☠ ${p.poison}</span>`);
    // One badge per commander that has hit this player, biggest first.
    Object.entries(p.cmd)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .forEach(([key, v]) => {
        const [j, idx] = key.split(":").map(Number);
        const src = game.setup.seats[j];
        const names = cmdNames(src);
        badges.push(
          `<span class="badge cmd ${v >= Game.LETHAL_CMD ? "hot" : ""}" title="${esc(src.name)}: ${esc(names[idx] || "")}">${avatar(src)}⚔ ${v}${names.length > 1 ? `<sup>${idx + 1}</sup>` : ""}</span>`
        );
      });
    p.tax.forEach((casts) => {
      if (casts) badges.push(`<span class="badge">${t("taxShort")} +${casts * 2}</span>`);
    });
    for (const [name, v] of Object.entries(p.counters)) if (v) badges.push(`<span class="badge">${counterLabel(name)} ${v}</span>`);
    if (p.cantLose) badges.push(`<span class="badge" title="${t("cantLose")}">🛡</span>`);
    if (p.cantWin) badges.push(`<span class="badge" title="${t("cantWin")}">🚫</span>`);

    const pend = pendingLife(i);
    const deck = seat.deckName ? `<span class="deck">${esc(seat.deckName)}</span>` : "";
    const lethal =
      p.lethal && !p.out
        ? `<div class="lethal-bar"><span>${t("lethal_" + p.lethal.cause)}</span><button class="btn small danger" data-action="elimPrompt" data-seat="${i}">${t("eliminate")}</button></div>`
        : "";
    const out = p.out
      ? `<div class="out-cover"><b>${t("out")}</b><span>${t("cause_" + p.out.cause)}${Number.isInteger(p.out.by) && p.out.by !== i ? " · " + esc(game.setup.seats[p.out.by].name) : ""}</span></div>`
      : "";
    return `<div class="tile ${i === st.active ? "active" : ""} ${p.out ? "out" : ""} ${p.lethal ? "lethal" : ""}" style="grid-row:${pos[0]};grid-column:${pos[1]}">
      <div class="tile-inner r${rot} ${S.settings.showArt && seat.art ? "has-art" : ""}" style="--c:${esc(seat.color)}${S.settings.showArt && seat.art ? `;--art:url('${esc(seat.art)}')` : ""}">
        <div class="life-wrap">
          <button class="zone minus outer" data-life="-1" data-hold="step" data-seat="${i}" aria-label="−1"><span>−</span></button>
          <button class="zone minus inner" data-life="-1" data-hold="edit" data-seat="${i}" aria-label="−1"></button>
          <button class="zone plus inner" data-life="1" data-hold="edit" data-seat="${i}" aria-label="+1"></button>
          <button class="zone plus outer" data-life="1" data-hold="step" data-seat="${i}" aria-label="+1"><span>+</span></button>
          <div class="life">${p.life}${pend ? `<span class="pending">${fmtDelta(pend)}</span>` : ""}</div>
        </div>
        ${badges.length ? `<div class="tile-foot">${badges.join("")}</div>` : ""}
        <div class="tile-head">${avatar(seat)}<span class="who">${esc(seat.name)}</span>${deck}<button class="more" data-action="panel" data-seat="${i}" aria-label="${t("more")}">⋯</button></div>
        ${lethal}${out}
        ${ui.attrib && ui.attrib.seat === i ? attribStrip(i, st) : ""}
        ${ui.panel === i ? panelHtml(i, st) : ""}
      </div>
    </div>`;
  }

  function attribStrip(i, st) {
    const seats = game.setup.seats;
    const others = st.alive.filter((s) => s !== i);
    let current;
    if (ui.attrib.key) current = pending.has(ui.attrib.key) ? pending.get(ui.attrib.key).ev.source : null;
    else {
      const ev = game.events.find((e) => e.id === ui.attrib.evId);
      current = ev ? ev.source : null;
    }
    const on = (v) => (current === v ? " on" : "");
    return `<div class="attrib"><span>${t("fromWhom")}</span>${others
      .map((j) => `<button class="av${on(j)}" data-action="attrib" data-src="${j}" title="${esc(seats[j].name)}">${avatar(seats[j])}</button>`)
      .join("")}<button class="av paid${on(i)}" data-action="attrib" data-src="${i}" title="${t("paidLifeHint")}">🩸<small>${t("paidLife")}</small></button><button class="av skip${current == null ? " on" : ""}" data-action="attrib" data-src="">?</button></div>`;
  }

  function stepRow(label, value, attrs) {
    return `<div class="prow"><span class="plabel">${label}</span><button class="step" ${attrs} data-d="-1" ${value <= 0 ? "disabled" : ""}>−</button><span class="pval">${value}</span><button class="step" ${attrs} data-d="1">+</button></div>`;
  }

  function panelHtml(i, st) {
    const p = st.players[i];
    const seats = game.setup.seats;
    const cmdRows = seats
      .flatMap((s, j) =>
        cmdNames(s).map((name, idx) =>
          stepRow(`${avatar(s)}<span>${esc(name)}${j === i ? ` <small>(${t("own")})</small>` : ""}</span>`, p.cmd[j + ":" + idx] || 0, `data-action="cmd" data-seat="${i}" data-from="${j}" data-idx="${idx}"`)
        )
      )
      .join("");
    const taxRows = cmdNames(seats[i])
      .map((name, idx) => stepRow(`<span>${esc(name)} <small>(+${p.tax[idx] * 2})</small></span>`, p.tax[idx], `data-action="tax" data-seat="${i}" data-idx="${idx}"`))
      .join("");
    const counterRows = Object.entries(p.counters)
      .map(([name, v]) => stepRow(`<span>${counterLabel(name)}</span>`, v, `data-action="counter" data-seat="${i}" data-name="${esc(name)}"`))
      .join("");
    // Counters anyone has used (this game or recently) are offered to everyone.
    const usedHere = st.players.flatMap((pl) => Object.keys(pl.counters));
    const quick = [...new Set([...QUICK_COUNTERS, ...usedHere, ...(S.settings.recentCounters || [])])]
      .filter((c) => !(c in p.counters))
      .map((c) => `<button class="chip" data-action="counter" data-seat="${i}" data-name="${esc(c)}" data-d="1">+ ${counterLabel(c)}</button>`)
      .join("");
    const by = ui.cmdBy[i] == null ? null : ui.cmdBy[i];
    const dealtBy = `<div class="chips dealt-by"><small class="muted">${t("dealtBy")}</small><button class="chip ${by == null ? "on" : ""}" data-action="cmdBy" data-seat="${i}" data-v="">${t("ownerDefault")}</button>${seats
      .map((s, j) => (j === i ? "" : `<button class="chip ${by === j ? "on" : ""}" data-action="cmdBy" data-seat="${i}" data-v="${j}">${avatar(s)}${esc(s.name)}</button>`))
      .join("")}</div>`;
    const tokenBtn = (token, icon) =>
      `<button class="chip ${st[token] === i ? "on" : ""}" data-action="token" data-token="${token}" data-seat="${i}">${icon} ${t(token)}</button>`;
    const flagBtn = (flag, icon) => `<button class="chip ${p[flag] ? "on" : ""}" data-action="flag" data-flag="${flag}" data-seat="${i}">${icon} ${t(flag)}</button>`;
    return `<div class="panel">
      <div class="panel-head">${avatar(seats[i])}<b class="grow">${esc(seats[i].name)}</b><button class="icon-btn" data-action="panel" data-seat="${i}" aria-label="${t("close")}">✕</button></div>
      <div class="panel-body">
        <h3>${t("cmdDamageTaken")}</h3>${dealtBy}${cmdRows}
        <h3>${t("poison")}</h3>${stepRow(`<span>☠ ${t("poison")}</span>`, p.poison, `data-action="poison" data-seat="${i}"`)}
        <h3>${t("commanderTax")}</h3>${taxRows}
        <h3>${t("tokens")}</h3><div class="chips">${tokenBtn("monarch", "👑")}${tokenBtn("initiative", "🏰")}</div>
        <h3>${t("counters")}</h3>${counterRows}
        <div class="chips">${quick}</div>
        <form class="inline" data-submit="addCounter" data-seat="${i}"><input name="cname" placeholder="${t("customCounter")}" maxlength="16" autocomplete="off"><button class="btn small">+</button></form>
        <h3>${t("flags")}</h3><div class="chips">${flagBtn("cantLose", "🛡")}${flagBtn("cantWin", "🚫")}</div>
        <div class="actions">${p.out ? "" : `<button class="btn small" data-action="concede" data-seat="${i}">🏳 ${t("concede")}</button><button class="btn small danger" data-action="elimPrompt" data-seat="${i}">${t("eliminate")}</button>`}</div>
      </div>
    </div>`;
  }

  function hubHtml(st, rot) {
    const a = game.setup.seats[st.active];
    const timer = S.settings.turnTimer ? `<span class="timer" id="turnTimer">${fmtClock(Date.now() - st.turnStartedAt)}</span>` : "";
    return `<div class="hub r${rot}">
      <button class="hub-btn" data-action="undo" aria-label="${t("undo")}" ${game.events.some((e) => !e.reverted) || pending.size ? "" : "disabled"}>↶</button>
      <button class="hub-mid" data-action="nextTurn" style="--c:${esc(a.color)}"><span class="round">${t("roundN", { n: st.round })}${timer}</span><span class="act">${esc(a.name)}</span><span class="next">${t("nextTurn")} ▸</span></button>
      <button class="hub-btn" data-action="menu" aria-label="${t("menu")}">☰</button>
    </div>`;
  }

  function gameView() {
    const st = liveState();
    const n = game.setup.seats.length;
    const L = Game.layout(n, isLandscape());
    // "Face me": every tile reads the right way up for whoever holds the device.
    const seatsPos = L.seats.map((pos) => (S.settings.faceMe ? [pos[0], pos[1], 0] : pos));
    const tiles = game.setup.seats.map((s, i) => tileHtml(s, i, st, seatsPos[i])).join("");
    return `<div class="board ${S.settings.dimInactive ? "dim" : ""}" style="grid-template-rows:${L.rows};grid-template-columns:${L.cols}">${tiles}</div>${ui.panel == null ? hubHtml(st, seatsPos[st.active][2]) : ""}`;
  }

  function playersView() {
    const regulars = S.players.filter((p) => !p.guest);
    const guests = S.players.filter((p) => p.guest);
    const gamesOf = (id) => S.matches.filter((m) => m.seats.some((s) => s.playerId === id)).length;
    const item = (p) =>
      `<button class="list-item" data-action="nav" data-to="player" data-id="${p.id}">${avatar(p)}<span class="grow"><b>${esc(p.name)}</b><small class="muted">${t("nDecks", { n: Store.decksOf(p.id).length })} · ${t("nGames", { n: gamesOf(p.id) })}</small></span><span class="chev">›</span></button>`;
    return `${header(t("playersDecks"))}
    <div class="page">
      <section>${regulars.map(item).join("") || `<p class="muted">${t("noPlayersYet")}</p>`}
        <button class="btn primary" data-action="addPlayer">+ ${t("addPlayer")}</button></section>
      ${guests.length ? `<section><h2>${t("guests")}</h2><p class="muted small">${t("guestHint")}</p>${guests
        .map(
          (g) =>
            `<div class="list-item">${avatar(g)}<span class="grow"><b>${esc(g.name)}</b><small class="muted">${t("nGames", { n: gamesOf(g.id) })}</small></span>
            <button class="btn small" data-action="promoteGuest" data-id="${g.id}">${t("makeRegular")}</button>
            ${regulars.length ? `<button class="btn small" data-action="mergeGuest" data-id="${g.id}">${t("mergeInto")}</button>` : ""}</div>`
        )
        .join("")}</section>` : ""}
    </div>`;
  }

  function playerView() {
    const p = Store.player(ui.params.id);
    if (!p) return playersView();
    const decks = Store.decksOf(p.id);
    return `${header(esc(p.name), "players")}
    <div class="page">
      <section>
        <label class="field"><span>${t("name")}</span><input value="${esc(p.name)}" maxlength="24" data-change="pName" autocomplete="off"></label>
        <h3>${t("color")}</h3><div class="swatches">${COLORS.map((c) => `<button class="swatch ${p.color === c ? "on" : ""}" style="--c:${c}" data-action="pColor" data-v="${c}" aria-label="${c}"></button>`).join("")}</div>
        <h3>${t("avatar")}</h3><div class="swatches">${AVATARS.map((a) => `<button class="emoji ${p.avatar === a ? "on" : ""}" data-action="pAvatar" data-v="${a}">${a}</button>`).join("")}
          <input class="emoji-in" value="${AVATARS.includes(p.avatar) ? "" : esc(p.avatar)}" maxlength="4" placeholder="Aa" data-change="pAvatarCustom" aria-label="${t("avatar")}"></div>
      </section>
      <section><h2>${t("decks")}</h2>
        ${decks
          .map(
            (d) =>
              `<button class="list-item" data-action="openDeck" data-id="${d.id}">${d.art ? `<img class="art" src="${esc(d.art)}" alt="" loading="lazy">` : ""}<span class="grow"><b>${esc(d.name)}</b><small class="muted">${esc(d.commanders.filter(Boolean).join(" + "))}</small></span>${pips(d.colors)}${deckBadge(d)}${d.analysis && (d.analysis.banned.length || d.analysis.offColor.length) ? `<span class="tag bad">⚠</span>` : ""}</button>`
          )
          .join("") || `<p class="muted">${t("noDecksYet")}</p>`}
        <button class="btn primary" data-action="openDeck" data-owner="${p.id}">+ ${t("addDeck")}</button>
      </section>
      <button class="btn danger" data-action="deletePlayer" data-id="${p.id}">${t("deletePlayer")}</button>
    </div>`;
  }

  function checkHtml(d) {
    const a = d.analysis;
    if (d.checking) return `<p class="muted">🔍 ${t("checking")}</p>`;
    if (!a) return "";
    const stale = a.fp && d.list && Decks.fingerprint(Decks.parseList(d.list).cards) !== a.fp;
    const names = (list) => `<small class="muted">${esc(list.join(", "))}</small>`;
    const item = (cls, text, list) => `<li class="${cls}">${text}${list && list.length ? " " + names(list) : ""}</li>`;
    const rows = [
      item(a.total === 100 ? "ok" : "bad", t("ck_count", { n: a.total })),
      a.banned.length ? item("bad", t("ck_banned", { n: a.banned.length }), a.banned) : item("ok", t("ck_noBanned")),
      a.offColor.length ? item("bad", t("ck_offColor", { n: a.offColor.length }), a.offColor) : "",
      item(a.gameChangers.length ? "info" : "ok", t("ck_gc", { n: a.gameChangers.length }), a.gameChangers),
      a.mld.length ? item("info", t("ck_mld"), a.mld) : "",
      a.extraTurns.length ? item("info", t("ck_extraTurns", { n: a.extraTurns.length }), a.extraTurns) : "",
      a.combos.length ? item("info", t("ck_combos", { n: a.combos.length }), a.combos.map((c) => c.join(" + "))) : "",
      a.tutors.length ? item("info", t("ck_tutors", { n: a.tutors.length })) : "",
    ].join("");
    return `<div class="check">
      <div class="check-head"><b>${t("estBracket", { n: a.estimate.bracket })}</b><button class="btn small" data-action="useEstimate">${t("useEstimate")}</button></div>
      <p class="muted small">${a.estimate.reasons.map((r) => t(r.key, { n: r.n })).join(" ")} ${t("estimateNote")}</p>
      ${stale ? `<p class="warn">${t("ck_stale")}</p>` : ""}
      <ul>${rows}</ul>
      ${unknownHtml(a)}
    </div>`;
  }

  // Cards Scryfall didn't recognize: fix to the suggested name, edit by hand,
  // or keep as is (custom or proxy cards), which stops flagging them.
  function unknownHtml(a) {
    const sug = a.suggest || {};
    const fixable = a.notFound.filter((n) => sug[n]);
    const rows = a.notFound
      .map((n) => {
        const s = sug[n];
        return `<li class="unk">
          <span class="unk-name">✕ ${esc(n)}</span>
          ${s ? `<span class="unk-sug">${t("didYouMean")} <b>${esc(s.name)}</b>?</span>` : `<span class="unk-sug muted">${t("noSuggestion")}</span>`}
          <span class="unk-actions">${s ? `<button class="btn small primary" data-action="fixCard" data-from="${esc(n)}" data-to="${esc(s.name)}">${t("fixBtn")}</button>` : `<button class="btn small" data-action="editCard" data-name="${esc(n)}">${t("editBtn")}</button>`}<button class="btn small" data-action="keepCard" data-name="${esc(n)}">${t("keepBtn")}</button></span>
        </li>`;
      })
      .join("");
    const custom = (a.custom || [])
      .map((n) => `<li class="kept">${esc(n)} <button class="linkish" data-action="unkeepCard" data-name="${esc(n)}">${t("undo")}</button></li>`)
      .join("");
    return `${a.notFound.length ? `<div class="unknown"><div class="check-head"><b>${t("ck_notFound", { n: a.notFound.length })}</b>${fixable.length > 1 ? `<button class="btn small primary" data-action="fixAll">${t("fixAll", { n: fixable.length })}</button>` : ""}</div><ul>${rows}</ul></div>` : ""}
      ${custom ? `<div class="unknown"><p class="muted small">${t("ck_custom", { n: a.custom.length })}</p><ul>${custom}</ul></div>` : ""}`;
  }

  function deckModal() {
    const d = ui.deck;
    const owner = Store.player(d.ownerId);
    const scroll = modalRoot.querySelector(".modal") ? modalRoot.querySelector(".modal").scrollTop : 0;
    openModal(
      `<h2>${d.id ? t("editDeck") : t("addDeck")} <small class="muted">${esc(owner ? owner.name : "")}</small></h2>
      <form class="field" data-submit="moxImport"><span>${t("importMoxfield")}</span>
        <div class="inline"><input id="dMox" inputmode="url" placeholder="https://moxfield.com/decks/…" value="${esc(d.moxUrl || (d.source && d.source.url) || "")}" autocomplete="off"><button class="btn" ${d.importing ? "disabled" : ""}>${d.importing ? "…" : t("import")}</button></div></form>
      ${d.moxStep ? moxSteps(d) : ""}
      ${d.importMsg ? `<p class="${d.importOk ? "okmsg" : "warn"}">${d.importMsg}</p>` : ""}
      <label class="field"><span>${t("commander")}</span><input id="dC1" list="cmdList" data-scry data-change="cmdLookup" value="${esc(d.commanders[0] || "")}" autocomplete="off" placeholder="${t("searchScryfall")}"></label>
      <label class="field"><span>${t("partner")}</span><input id="dC2" list="cmdList" data-scry data-change="cmdLookup" value="${esc(d.commanders[1] || "")}" autocomplete="off" placeholder="${t("optional")}"></label>
      <datalist id="cmdList"></datalist>
      ${d.warn ? `<p class="warn">${d.warn}</p>` : ""}
      <label class="field"><span>${t("deckName")}</span><input id="dName" value="${esc(d.name)}" maxlength="40" placeholder="${esc(d.commanders[0] || "")}" autocomplete="off"></label>
      <div class="field"><span>${t("colorIdentity")}</span><div class="chips">${MANA.map((c) => `<button class="mana ${d.colors.includes(c) ? "on" : ""}" data-action="dColor" data-v="${c}"><i class="pip pip-${c}"></i></button>`).join("")}</div></div>
      <label class="field"><span>${t("decklist")} <small class="muted">${t("decklistHint")}</small></span><textarea id="dList" rows="6" placeholder="1 Sol Ring&#10;1 Arcane Signet&#10;…">${esc(d.list || "")}</textarea></label>
      <div class="actions"><button class="btn" data-action="pasteClipboard">📋 ${t("pasteClipboard")}</button><button class="btn" data-action="checkDeck" ${d.checking ? "disabled" : ""}>🔍 ${t("checkDeck")}</button></div>
      ${checkHtml(d)}
      <label class="field"><span>${t("bracket")} <small class="muted">${t("bracketHint")}</small></span><select id="dBracket"><option value="">—</option>${[1, 2, 3, 4, 5]
        .map((b) => `<option value="${b}" ${d.bracket === b ? "selected" : ""}>${b}</option>`)
        .join("")}</select></label>
      ${d.version ? `<p class="muted small">${t("deckVersion", { v: d.version, date: fmtDate((d.versions || []).slice(-1)[0] ? d.versions.slice(-1)[0].at : Date.now()) })}</p>` : ""}
      <div class="actions">${d.id ? `<button class="btn danger" data-action="deckDelete">${t("delete")}</button>` : ""}<button class="btn" data-action="saveDeckTxt">⬇ ${t("saveTxt")}</button><span class="grow"></span>
        <button class="btn" data-action="closeModal">${t("cancel")}</button><button class="btn primary" data-action="deckSave">${t("save")}</button></div>`
    );
    const m = modalRoot.querySelector(".modal");
    if (m) m.scrollTop = scroll;
  }

  function moxSteps(d) {
    const id = Decks.moxfieldId(d.moxUrl);
    const link = id ? "https://moxfield.com/decks/" + id : "https://moxfield.com";
    return `<div class="steps">
      <p>${t("moxStepIntro")}</p>
      <ol>
        <li><a class="btn small" href="${esc(link)}" target="_blank" rel="noopener">${t("openOnMoxfield")} ↗</a> ${t("moxStepExport")}</li>
        <li>${t("moxStepBack")} <button class="btn small primary" data-action="pasteClipboard">📋 ${t("pasteClipboard")}</button></li>
      </ol>
      <p class="muted small">${t("moxStepOneTap")} <button class="linkish" data-action="nav" data-to="settings">${t("settings")} ›</button></p>
    </div>`;
  }

  function download(name, text, type) {
    const blob = new Blob([text], { type: type || "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function appUrl() {
    return location.origin + location.pathname;
  }

  // A deck handed over by the bookmarklet (#import=...) waits here until
  // someone says whose deck it is.
  function takeFragment() {
    const incoming = Decks.fromFragment(location.hash);
    if (!location.hash.startsWith("#import=")) return;
    history.replaceState(null, "", location.pathname + location.search);
    if (!incoming) return toast(t("importFailed"));
    ui.incoming = incoming;
    if (ui.view === "game") ui.view = "home";
    render();
    openModal(
      `<h2>📥 ${t("incomingTitle", { name: incoming.name || incoming.commanders[0] || "" })}</h2>
      <p class="muted small">${t("incomingHint", { n: incoming.cards.reduce((sum, c) => sum + c.q, 0) })}</p>
      <div class="chips">${S.players
        .filter((p) => !p.guest)
        .map((p) => `<button class="chip" data-action="incomingFor" data-id="${p.id}">${avatar(p)}${esc(p.name)}</button>`)
        .join("")}<button class="chip" data-action="incomingFor" data-id="">+ ${t("addPlayer")}</button></div>`,
      "small"
    );
  }

  function readDeckForm() {
    const d = ui.deck;
    if (!$("#dName")) return;
    const v = (id) => ($(id) ? $(id).value.trim() : "");
    d.commanders = [v("#dC1"), v("#dC2")].filter(Boolean);
    d.name = v("#dName");
    d.list = $("#dList").value;
    d.moxUrl = v("#dMox");
    d.bracket = v("#dBracket") ? Number(v("#dBracket")) : null;
    // A pasted list with a Commander section fills empty commander fields.
    if (!d.commanders.length && d.list) d.commanders = Decks.parseList(d.list).commanders.slice(0, 2);
  }

  async function runCheck(d) {
    const parsed = Decks.parseList(d.list);
    if (!parsed.cards.length && !d.commanders.length) return toast(t("needList"));
    d.checking = true;
    deckModal();
    try {
      d.commanders = d.commanders.map(Decks.normalizeName);
      const known = new Set((d.known || []).map((n) => n.toLowerCase()));
      const names = parsed.cards.map((c) => c.n).concat(d.commanders).filter((n) => !known.has(n.toLowerCase()));
      const { found, fetched } = await Decks.fetchCards(names, Store.cardCache);
      if (!d.colors) d.colors = Decks.colorsOf(d.commanders, found);
      const lead = d.commanders[0] && found.get(d.commanders[0].toLowerCase());
      if (lead && lead.art) d.art = lead.art;
      d.analysis = Decks.analyze(parsed.cards, d.commanders, d.colors, found, d.known);
      d.analysis.fp = Decks.fingerprint(parsed.cards);
      if (d.analysis.notFound.length) d.analysis.suggest = await Decks.suggest(d.analysis.notFound, Store.cardCache);
      if (fetched || d.analysis.notFound.length) Store.saveCards();
    } catch (e) {
      toast(navigator.onLine ? t("scryfallFailed") : t("needOnline"));
    }
    d.checking = false;
    if (ui.deck === d && $("#dName")) {
      readDeckForm();
      deckModal();
    }
  }

  function fixNames(d, map) {
    for (const [from, to] of Object.entries(map)) {
      d.list = Decks.replaceName(d.list, from, to);
      d.commanders = d.commanders.map((c) => (Decks.normalizeName(c).toLowerCase() === Decks.normalizeName(from).toLowerCase() ? to : c));
    }
    const n = Object.keys(map).length;
    if (n) toast(t("fixedN", { n }));
    runCheck(d);
  }

  function deckBadge(d) {
    if (d.bracket) return `<span class="tag">B${d.bracket}</span>`;
    if (d.analysis) return `<span class="tag" title="${t("estimate")}">~B${d.analysis.estimate.bracket}</span>`;
    return "";
  }

  function balanceWarnings(su) {
    if (su.quick) return [];
    const decks = su.seats.map((s) => Store.deck(s.deckId)).filter(Boolean);
    if (decks.length < 2) return [];
    const warns = [];
    const ranked = decks
      .map((d) => ({ d, b: d.bracket || (d.analysis && d.analysis.estimate.bracket) || null }))
      .filter((x) => x.b)
      .sort((a, b) => b.b - a.b);
    if (ranked.length >= 2 && ranked[0].b - ranked[ranked.length - 1].b >= 2) {
      warns.push(t("bal_bracket", { deck: ranked[0].d.name, b: ranked[0].b, low: ranked[ranked.length - 1].b }));
    }
    const rows = Stats.compute(S.matches).decks.filter((r) => r.games >= 3 && decks.some((d) => d.id === r.id));
    for (const r of rows) {
      const others = rows.filter((o) => o !== r);
      if (!others.length) continue;
      const avg = others.reduce((sum, o) => sum + Stats.rate(o), 0) / others.length;
      if (Stats.rate(r) >= 0.5 && Stats.rate(r) - avg >= 0.25) warns.push(t("bal_winrate", { deck: Store.deck(r.id).name, pct: pct(Stats.rate(r)), games: r.games }));
    }
    return warns;
  }

  function historyView() {
    const list = [...S.matches].sort((a, b) => b.date - a.date);
    return `${header(t("history"))}
    <div class="page">${list
      .map((m) => {
        const w = Number.isInteger(m.winnerSeat) ? m.seats[m.winnerSeat] : null;
        return `<button class="list-item" data-action="nav" data-to="match" data-id="${m.id}"><span class="grow"><b>${w ? "🏆 " + esc(w.name) + (w.deckName ? ` <small>· ${esc(w.deckName)}</small>` : "") : t("noWinner")}</b>
          <small class="muted">${fmtDate(m.date)} · ${esc(m.seats.map((s) => s.name).join(", "))}${m.rounds ? " · " + t("roundsN", { n: m.rounds }) : ""}${m.manual ? " · " + t("loggedAfter") : ""}</small></span><span class="chev">›</span></button>`;
      })
      .join("") || `<p class="muted">${t("noMatchesYet")}</p>`}</div>`;
  }

  function matchView() {
    const m = S.matches.find((x) => x.id === ui.params.id);
    if (!m) return historyView();
    const n = m.seats.length;
    const elim = {};
    for (const e of m.eliminations || []) elim[e.seat] = e;
    const seatRows = m.seats
      .map((s, i) => {
        const e = elim[i];
        const fate = m.winnerSeat === i ? `🏆 ${t("winner")}` : e ? `${t("cause_" + e.cause)}${Number.isInteger(e.by) && e.by !== i ? " · " + esc(m.seats[e.by].name) : ""}${e.round ? " · " + t("roundN", { n: e.round }) : ""}` : "";
        return `<tr><td>${i === m.firstSeat ? "🎲 " : ""}${esc(s.name)}</td><td>${esc(s.deckName || "—")}${s.deckVersion > 1 ? ` <small class="muted">v${s.deckVersion}</small>` : ""}</td><td>${m.finalLife ? m.finalLife[i] : ""}</td><td>${fate}</td></tr>`;
      })
      .join("");
    const dmg =
      m.damage && m.damage.some((r) => r.some(Boolean))
        ? `<section><h2>${t("damageMatrix")}</h2><p class="muted small">${t("damageHint")}</p><div class="scroll-x"><table class="matrix"><tr><th></th>${m.seats.map((s) => `<th>${esc(s.name)}</th>`).join("")}</tr>${m.damage
            .map((row, i) => `<tr><th>${esc(m.seats[i].name)}</th>${row.map((v, j) => `<td class="${i === j ? "self" : ""}">${v || ""}</td>`).join("")}</tr>`)
            .join("")}</table></div></section>`
        : "";
    const log = (m.events || []).length
      ? `<details><summary>${t("actionLog")} (${m.events.length})</summary><ol class="log">${m.events.map((e) => `<li><small>${t("roundShort", { n: e.round })} · ${fmtTime(e.t)}</small> ${describe(e, m.seats)}</li>`).join("")}</ol></details>`
      : "";
    return `${header(fmtDate(m.date), "history")}
    <div class="page">
      <section class="facts">
        <div><b>${Number.isInteger(m.winnerSeat) ? esc(m.seats[m.winnerSeat].name) : "—"}</b><small>${m.winType ? t("win_" + m.winType) : t("winner")}</small></div>
        <div><b>${m.rounds || "—"}</b><small>${t("rounds")}</small></div>
        <div><b>${m.durationMin ? m.durationMin + "′" : "—"}</b><small>${t("duration")}</small></div>
        <div><b>${n}</b><small>${t("players")}</small></div>
      </section>
      <section><div class="scroll-x"><table><tr><th>${t("player")}</th><th>${t("deck")}</th><th>${t("life")}</th><th></th></tr>${seatRows}</table></div></section>
      <section><h2>${t("recap")}</h2><div class="recap">${Recap.recap(m, I18n.fmt)
        .map((line) => `<p>${esc(line)}</p>`)
        .join("")}</div><button class="btn" data-action="shareRecap" data-id="${m.id}">📤 ${t("shareRecap")}</button></section>
      ${dmg}${log}
      <button class="btn danger" data-action="deleteMatch" data-id="${m.id}">${t("deleteMatch")}</button>
    </div>`;
  }

  function manualView() {
    const mu = ui.manual;
    const rows = mu.seats
      .map((s, i) => {
        const p = Store.player(s.playerId);
        return `<div class="row">${avatar(p)}<span class="grow">${esc(p.name)}</span><select data-change="manDeck" data-seat="${i}">${deckOptions(p.id, s.deckId)}</select>
        <button class="chip ${mu.winner === i ? "on" : ""}" data-action="manWinner" data-seat="${i}">🏆</button></div>`;
      })
      .join("");
    return `${header(t("logPastGame"))}
    <div class="page">
      <section><h2>${t("whoPlayed")}</h2>${podChips(mu.seats, "manToggle")}</section>
      ${mu.seats.length ? `<section><h2>${t("decksAndWinner")}</h2><p class="muted small">${t("seatOrderHint")}</p>${rows}</section>` : ""}
      <section class="two">
        <label class="field"><span>${t("date")}</span><input type="date" value="${mu.date}" data-change="manDate"></label>
        <label class="field"><span>${t("rounds")} <small class="muted">${t("optional")}</small></span><input type="number" min="1" inputmode="numeric" value="${mu.rounds}" data-change="manRounds"></label>
      </section>
      <button class="btn primary big" data-action="manSave" ${mu.seats.length < Game.MIN_PLAYERS ? "disabled" : ""}>${t("saveMatch")}</button>
    </div>`;
  }

  function seasonLabel(key) {
    const [y, q] = key.split("-");
    return t("seasonLabel", { q: q.slice(1), y });
  }

  function seasonChips(selected, action, withAll) {
    const keys = Stats.seasons(S.matches);
    return `<div class="chips">${withAll ? `<button class="chip ${!selected ? "on" : ""}" data-action="${action}" data-v="">${t("allTime")}</button>` : ""}${keys
      .map((k) => `<button class="chip ${selected === k ? "on" : ""}" data-action="${action}" data-v="${k}">${seasonLabel(k)}</button>`)
      .join("")}</div>`;
  }

  function statsView() {
    const s = Stats.compute(Stats.inSeason(S.matches, ui.statsSeason));
    const filter = S.matches.length ? seasonChips(ui.statsSeason, "statsSeason", true) : "";
    if (!s.games) return `${header(t("stats"))}<div class="page">${filter}<p class="muted">${t("noMatchesYet")}</p></div>`;
    const pname = (r) => {
      const p = Store.player(r.id);
      return esc(p ? p.name : r.name);
    };
    const dname = (r) => {
      const d = Store.deck(r.id);
      const owner = Store.player(r.ownerId);
      return `${esc(d ? d.name : r.name)}${owner ? ` <small class="muted">${esc(owner.name)}</small>` : ""}`;
    };
    const bar = (r) => `<span class="bar-cell"><i style="width:${pct(Stats.rate(r))}"></i></span>${pct(Stats.rate(r))}`;
    const posTable = (rows, label) =>
      rows.length
        ? `<table><tr><th>${label}</th><th>${t("games")}</th><th>${t("wins")}</th><th>${t("winRate")}</th></tr>${rows
            .map((r, i) => `<tr><td>${i + 1}</td><td>${r.games}</td><td>${r.wins}</td><td>${bar(r)}</td></tr>`)
            .join("")}</table>`
        : "";
    const fmt1 = (x) => (x == null ? "—" : (Math.round(x * 10) / 10).toLocaleString(locale()));
    return `${header(t("stats"))}
    <div class="page">
      ${filter}
      <section class="facts">
        <div><b>${s.games}</b><small>${t("games")}</small></div>
        <div><b>${fmt1(s.avgRounds)}</b><small>${t("avgRounds")}</small></div>
        <div><b>${s.avgMinutes == null ? "—" : Math.round(s.avgMinutes) + "′"}</b><small>${t("avgMinutes")}</small></div>
      </section>
      <section class="facts">
        <div><b>${s.mostDamage ? pname(s.mostDamage) : "—"}</b><small>${t("mostDamage")}${s.mostDamage ? ` · ${s.mostDamage.damage}` : ""}</small></div>
        <div><b>${s.mostKnockouts ? pname(s.mostKnockouts) : "—"}</b><small>${t("mostKnockouts")}${s.mostKnockouts ? ` · ${s.mostKnockouts.knockouts}` : ""}</small></div>
      </section>
      <section><h2>${t("players")}</h2><div class="scroll-x"><table><tr><th>${t("player")}</th><th>${t("games")}</th><th>${t("wins")}</th><th>${t("winRate")}</th><th>⚔</th><th>💀</th></tr>${s.players
        .map((r) => `<tr><td>${pname(r)}</td><td>${r.games}</td><td>${r.wins}</td><td>${bar(r)}</td><td>${r.damage}</td><td>${r.knockouts}</td></tr>`)
        .join("")}</table></div><p class="muted small">⚔ ${t("damageDealt")} · 💀 ${t("knockouts")}</p></section>
      ${s.decks.length ? `<section><h2>${t("decks")}</h2><div class="scroll-x"><table><tr><th>${t("deck")}</th><th>${t("games")}</th><th>${t("wins")}</th><th>${t("winRate")}</th></tr>${s.decks
        .map((r) => `<tr><td>${dname(r)}</td><td>${r.games}</td><td>${r.wins}</td><td>${bar(r)}</td></tr>`)
        .join("")}</table></div></section>` : ""}
      ${s.turnOrder.length ? `<section><h2>${t("winsByTurnOrder")}</h2>${posTable(s.turnOrder, t("turnPosition"))}</section>` : ""}
      <section><h2>${t("winsBySeat")}</h2><p class="muted small">${t("seatStatHint")}</p>${posTable(s.seats, t("seat"))}</section>
    </div>`;
  }

  function nameFor(kind, id) {
    if (kind === "deck") {
      const d = Store.deck(id);
      if (d) return d.name;
    } else {
      const p = Store.player(id);
      if (p) return p.name;
    }
    for (let k = S.matches.length - 1; k >= 0; k--) {
      const s = S.matches[k].seats.find((x) => (kind === "deck" ? x.deckId : x.playerId) === id);
      if (s) return kind === "deck" ? s.deckName : s.name;
    }
    return "?";
  }

  function rivalriesView() {
    const { kind } = ui.riv;
    const rows = Stats.headToHead(S.matches, kind);
    const ids = Object.keys(rows).sort((a, b) => nameFor(kind, a).localeCompare(nameFor(kind, b)));
    const tabs = `<div class="chips"><button class="chip ${kind === "player" ? "on" : ""}" data-action="rivKind" data-v="player">${t("players")}</button><button class="chip ${kind === "deck" ? "on" : ""}" data-action="rivKind" data-v="deck">${t("decks")}</button></div>`;
    if (!ids.length) return `${header(t("rivalries"))}<div class="page">${tabs}<p class="muted">${t("noRivalries")}</p></div>`;
    const id = ids.includes(ui.riv.id) ? ui.riv.id : ids[0];
    const mine = rows[id];
    const nemesis = Stats.topBy(mine, "koTaken");
    const victim = Stats.topBy(mine, "koGiven");
    const opponents = Object.entries(mine).sort((a, b) => b[1].games - a[1].games);

    // The busiest head-to-heads across the whole group.
    const pairs = [];
    for (const a of ids) for (const [b, r] of Object.entries(rows[a])) if (a < b) pairs.push({ a, b, r });
    pairs.sort((x, y) => y.r.games - x.r.games || Math.abs(x.r.wins - x.r.losses) - Math.abs(y.r.wins - y.r.losses));

    return `${header(t("rivalries"))}
    <div class="page">
      ${tabs}
      <div class="chips">${ids.map((x) => `<button class="chip ${x === id ? "on" : ""}" data-action="rivPick" data-v="${esc(x)}">${esc(nameFor(kind, x))}</button>`).join("")}</div>
      <section class="facts">
        <div><b>${nemesis ? esc(nameFor(kind, nemesis.id)) : "—"}</b><small>😈 ${t("nemesis")}${nemesis ? " · " + t("koCount", { n: nemesis.r.koTaken }) : ""}</small></div>
        <div><b>${victim ? esc(nameFor(kind, victim.id)) : "—"}</b><small>🎯 ${t("favoriteTarget")}${victim ? " · " + t("koCount", { n: victim.r.koGiven }) : ""}</small></div>
      </section>
      <section><h2>${t("headToHead")}</h2><p class="muted small">${t("h2hHint")}</p><div class="scroll-x"><table><tr><th>${t("opponent")}</th><th>${t("games")}</th><th>${t("record")}</th><th>💀 ${t("koGivenTaken")}</th></tr>${opponents
        .map(([o, r]) => `<tr><td>${esc(nameFor(kind, o))}</td><td>${r.games}</td><td>${r.wins}–${r.losses}</td><td>${r.koGiven} / ${r.koTaken}</td></tr>`)
        .join("")}</table></div></section>
      <section><h2>${t("topRivalries")}</h2>${pairs
        .slice(0, 5)
        .map((x) => `<div class="list-item"><span class="grow"><b>${esc(nameFor(kind, x.a))} ⚔ ${esc(nameFor(kind, x.b))}</b><small class="muted">${t("pairLine", { w: x.r.wins, l: x.r.losses, n: x.r.games })}</small></span></div>`)
        .join("")}</section>
    </div>`;
  }

  function seasonsView() {
    const keys = Stats.seasons(S.matches);
    const key = keys.includes(ui.season) ? ui.season : keys[0];
    const current = key === Stats.seasonKey(Date.now());
    const ms = Stats.inSeason(S.matches, key);
    const a = Stats.awards(ms);
    const pname = (r) => esc(nameFor("player", r.id));
    const award = (icon, label, who, detail) => `<div class="award"><span class="award-icon">${icon}</span><small>${label}</small><b>${who || "—"}</b>${detail ? `<small class="muted">${detail}</small>` : ""}</div>`;
    const body = ms.length
      ? `<section class="${current ? "" : "season-done"}"><h2>${current ? t("leadersSoFar") : "🎉 " + t("seasonAwards")}</h2>
          <div class="awards">
            ${award("👑", t("champion"), a.champion && pname(a.champion), a.champion && t("winsOf", { w: a.champion.wins, n: a.champion.games }))}
            ${award("⚔️", t("mostDamage"), a.mostDamage && pname(a.mostDamage), a.mostDamage && String(a.mostDamage.damage))}
            ${award("💀", t("mostKnockouts"), a.mostKnockouts && pname(a.mostKnockouts), a.mostKnockouts && String(a.mostKnockouts.knockouts))}
            ${award("🃏", t("bestDeck"), a.bestDeck && esc(nameFor("deck", a.bestDeck.id)), a.bestDeck && pct(Stats.rate(a.bestDeck)))}
          </div></section>
        <section><h2>${t("standings")}</h2><div class="scroll-x"><table><tr><th>#</th><th>${t("player")}</th><th>${t("wins")}</th><th>${t("games")}</th><th>${t("winRate")}</th><th>💀</th></tr>${a.standings
          .map((r, i) => `<tr><td>${i + 1}</td><td>${pname(r)}</td><td><b>${r.wins}</b></td><td>${r.games}</td><td>${pct(Stats.rate(r))}</td><td>${r.knockouts}</td></tr>`)
          .join("")}</table></div></section>
        <button class="btn" data-action="seasonStats" data-v="${key}">📊 ${t("seasonFullStats")}</button>`
      : `<p class="muted">${t("noMatchesSeason")}</p>`;
    return `${header(t("seasons"))}
    <div class="page">
      ${seasonChips(key, "seasonPick", false)}
      <p class="muted small">${t("seasonHint")}</p>
      ${body}
    </div>`;
  }

  function settingsView() {
    const st = S.settings;
    const toggle = (key) => `<label class="row"><input type="checkbox" data-change="setToggle" data-key="${key}" ${st[key] ? "checked" : ""}><span class="grow">${t("set_" + key)}<small class="muted">${t("set_" + key + "_hint")}</small></span></label>`;
    return `${header(t("settings"))}
    <div class="page">
      <section>
        <label class="field"><span>${t("language")}</span><select data-change="lang"><option value="en" ${st.lang === "en" ? "selected" : ""}>English</option><option value="he" ${st.lang === "he" ? "selected" : ""}>עברית</option></select></label>
        <label class="field"><span>${t("defaultStartingLife")}</span><input type="number" min="1" max="999" inputmode="numeric" value="${st.startingLife}" data-change="defaultLife"></label>
        ${toggle("keepAwake")}${toggle("dimInactive")}${toggle("turnTimer")}${toggle("showArt")}${toggle("faceMe")}${toggle("sound")}
        <label class="field"><span>${t("holdStep")}</span><select data-change="holdStep">${[5, 10].map((n) => `<option value="${n}" ${Number(st.holdStep || 10) === n ? "selected" : ""}>±${n}</option>`).join("")}</select></label>
        <p class="muted small">${t("holdStepHint")}</p>
      </section>
      <section><h2>⭐ ${t("oneTapTitle")}</h2>
        <p class="small">${t("oneTapIntro")}</p>
        <div class="actions"><a class="btn primary" href="${esc(Decks.bookmarklet(appUrl()))}" draggable="true">⭐ ${t("bookmarkletName")}</a><button class="btn" data-action="copyBookmarklet">📋 ${t("copyCode")}</button></div>
        <textarea id="bmCode" rows="3" readonly hidden>${esc(Decks.bookmarklet(appUrl()))}</textarea>
        <ol class="small howto"><li>${t("oneTapDesktop")}</li><li>${t("oneTapMobile")}</li><li>${t("oneTapUse")}</li></ol>
        <p class="muted small">${t("oneTapIos")}</p>
      </section>
      <section><h2>${t("cardCache")}</h2><p class="muted small">${t("cardCacheHint", { n: Object.keys(Store.cardCache).length })}</p>
        <div class="actions"><button class="btn" data-action="clearCards" ${Object.keys(Store.cardCache).length ? "" : "disabled"}>${t("clearCache")}</button></div>
      </section>
      <section><h2>${t("backup")}</h2><p class="muted small">${t("backupHint")}</p>
        <div class="actions"><button class="btn" data-action="exportData">⬇ ${t("export")}</button>
        <label class="btn">⬆ ${t("import")}<input type="file" accept="application/json,.json" data-change="importFile" hidden></label></div>
      </section>
      <section><button class="btn danger" data-action="eraseAll">${t("eraseAll")}</button></section>
      <p class="legal">${t("fanContent")}</p>
    </div>`;
  }

  const VIEWS = {
    home: homeView,
    setup: setupView,
    game: gameView,
    players: playersView,
    player: playerView,
    history: historyView,
    match: matchView,
    manual: manualView,
    stats: statsView,
    rivalries: rivalriesView,
    seasons: seasonsView,
    settings: settingsView,
  };

  function render() {
    I18n.setLang(S.settings.lang);
    if (ui.view === "game" && !game) ui.view = "home";
    if (ui.view === "setup" && !ui.setup) ui.view = "home";
    if (ui.view === "manual" && !ui.manual) ui.view = "home";
    const oldPanel = app.querySelector(".panel-body");
    const scroll = oldPanel ? oldPanel.scrollTop : 0;
    app.className = "view-" + ui.view;
    app.innerHTML = VIEWS[ui.view]();
    const newPanel = app.querySelector(".panel-body");
    if (newPanel) newPanel.scrollTop = scroll;
  }

  function go(view, params) {
    ui.view = view;
    ui.params = params || {};
    ui.panel = null;
    ui.attrib = null;
    closeModal();
    render();
    window.scrollTo(0, 0);
    updateWake();
  }

  // ---------- Game modals ----------

  function openMenu() {
    const canReroll = !game.events.length && !pending.size;
    openModal(
      `<h2>${t("menu")}</h2>
      <div class="menu-list">
        <button class="btn" data-action="showLog">📜 ${t("actionLog")}</button>
        <button class="btn" data-action="noteModal">📝 ${t("addNote")}</button>
        <button class="btn" data-action="tokenModal" data-token="monarch">👑 ${t("monarch")}</button>
        <button class="btn" data-action="tokenModal" data-token="initiative">🏰 ${t("initiative")}</button>
        <button class="btn" data-action="toggleFace">🔄 ${S.settings.faceMe ? t("faceSeats") : t("faceMeAction")}</button>
        ${canReroll ? `<button class="btn" data-action="reroll">🎲 ${t("rerollFirst")}</button>` : ""}
        <button class="btn primary" data-action="endPrompt">🏁 ${t("endGame")}</button>
        <button class="btn" data-action="restartGame">🔄 ${t("newGameSamePod")}</button>
        <button class="btn" data-action="nav" data-to="home">🏠 ${t("home")}</button>
        <button class="btn danger" data-action="discardGame">🗑 ${t("discardGame")}</button>
      </div>`,
      "small"
    );
  }

  function showLog() {
    const seats = game.setup.seats;
    const rows = [...game.events]
      .reverse()
      .map(
        (e) =>
          `<li><button class="log-item ${e.reverted ? "reverted" : ""}" data-action="logToggle" data-id="${e.id}"><small>${t("roundShort", { n: e.round })} · ${fmtTime(e.t)}</small><span>${describe(e, seats)}</span><em>${e.reverted ? t("restore") : t("revert")}</em></button></li>`
      )
      .join("");
    openModal(`<h2>${t("actionLog")}</h2><p class="muted small">${t("logHint")}</p><ol class="log">${rows || `<li class="muted">${t("logEmpty")}</li>`}</ol><div class="actions"><button class="btn primary" data-action="closeModal">${t("close")}</button></div>`);
  }

  function noteModal() {
    openModal(
      `<h2>${t("addNote")}</h2>
      <div class="chips">${NOTE_TAGS.map((tag) => `<button class="chip" data-action="noteTag" data-v="${t("tag_" + tag)}">${t("tag_" + tag)}</button>`).join("")}</div>
      <textarea id="noteText" rows="3" maxlength="280" placeholder="${t("notePlaceholder")}"></textarea>
      <div class="actions"><button class="btn" data-action="closeModal">${t("cancel")}</button><button class="btn primary" data-action="noteSave">${t("save")}</button></div>`,
      "small"
    );
    setTimeout(() => $("#noteText") && $("#noteText").focus(), 50);
  }

  function tokenModal(token) {
    const st = liveState();
    openModal(
      `<h2>${t(token)}</h2><div class="chips">${st.alive
        .map((i) => `<button class="chip ${st[token] === i ? "on" : ""}" data-action="tokenSet" data-token="${token}" data-seat="${i}">${avatar(game.setup.seats[i])}${esc(game.setup.seats[i].name)}</button>`)
        .join("")}<button class="chip ${st[token] == null ? "on" : ""}" data-action="tokenSet" data-token="${token}" data-seat="">${t("nobody")}</button></div>`,
      "small"
    );
  }

  function lifeEditor() {
    const { seat, mode, amount, source } = ui.edit;
    const st = liveState();
    const seats = game.setup.seats;
    const life = st.players[seat].life;
    const amt = parseInt(amount, 10);
    const after = !Number.isFinite(amt) ? null : mode === "set" ? amt : mode === "gain" ? life + amt : life - amt;
    const losing = after != null ? after < life : mode !== "gain";
    const others = st.alive.filter((x) => x !== seat);
    const src = (v, label) => `<button class="chip ${source === v ? "on" : ""}" data-action="lifeSrc" data-v="${v == null ? "" : v}">${label}</button>`;
    openModal(
      `<h2>${avatar(seats[seat])} ${esc(seats[seat].name)} <small class="muted">${t("life")} ${life}</small></h2>
      <div class="chips">${["lose", "gain", "set"].map((m) => `<button class="chip ${mode === m ? "on" : ""}" data-action="lifeMode" data-v="${m}">${t("mode_" + m)}</button>`).join("")}</div>
      <input id="lifeAmt" type="number" inputmode="numeric" min="0" max="999" value="${esc(amount)}" placeholder="${mode === "set" ? life : "0"}" autocomplete="off">
      ${mode === "set" ? "" : `<div class="chips">${[1, 2, 3, 5, 7, 10, 20].map((n) => `<button class="chip" data-action="lifeAmt" data-v="${n}">${n}</button>`).join("")}</div>`}
      ${losing ? `<h3>${t("fromWhom")}</h3><div class="chips">${others.map((j) => src(j, avatar(seats[j]) + esc(seats[j].name))).join("")}${src(seat, "🩸 " + t("paidLife"))}${src(null, t("unknown"))}</div>` : ""}
      <p class="life-preview" id="lifePreview">${after == null ? "&nbsp;" : `${life} → <b>${after}</b>`}</p>
      <div class="actions"><button class="btn" data-action="closeModal">${t("cancel")}</button><button class="btn primary" data-action="lifeApply">${t("apply")}</button></div>`,
      "small"
    );
    const input = $("#lifeAmt");
    if (input) {
      input.focus();
      input.addEventListener("input", () => {
        const v = parseInt(input.value, 10);
        const next = !Number.isFinite(v) ? null : ui.edit.mode === "set" ? v : ui.edit.mode === "gain" ? life + v : life - v;
        $("#lifePreview").innerHTML = next == null ? "&nbsp;" : `${life} → <b>${next}</b>`;
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") A.lifeApply();
      });
    }
  }

  function readLifeEditor() {
    const input = $("#lifeAmt");
    if (input && ui.edit) ui.edit.amount = input.value;
  }

  function openLifeEditor(seat) {
    flushAll();
    const others = liveState().alive.filter((x) => x !== seat);
    ui.edit = { seat, mode: "lose", amount: "", source: others.length === 1 ? others[0] : null };
    render();
    lifeEditor();
  }

  function guessKiller(seat) {
    for (let k = game.events.length - 1; k >= 0; k--) {
      const e = game.events[k];
      if (e.reverted || e.seat !== seat) continue;
      if (e.type === "life" && Number.isInteger(e.source) && e.source !== seat) return e.source;
      if (e.type === "cmd") {
        const by = Number.isInteger(e.by) ? e.by : e.from;
        if (by !== seat) return by;
      }
    }
    return null;
  }

  function showElim() {
    const { seat, cause, by } = ui.elim;
    const seats = game.setup.seats;
    const st = liveState();
    const others = st.alive.filter((s) => s !== seat);
    openModal(
      `<h2>${t("eliminateX", { name: seats[seat].name })}</h2>
      <h3>${t("how")}</h3><div class="chips">${CAUSES.map((c) => `<button class="chip ${cause === c ? "on" : ""}" data-action="elimCause" data-v="${c}">${t("cause_" + c)}</button>`).join("")}</div>
      <h3>${t("byWhom")}</h3><div class="chips">${others
        .map((j) => `<button class="chip ${by === j ? "on" : ""}" data-action="elimBy" data-v="${j}">${avatar(seats[j])}${esc(seats[j].name)}</button>`)
        .join("")}<button class="chip ${by == null ? "on" : ""}" data-action="elimBy" data-v="">${t("unknown")}</button></div>
      <div class="actions"><button class="btn" data-action="closeModal">${t("cancel")}</button><button class="btn danger" data-action="elimConfirm">${t("eliminate")}</button></div>`,
      "small"
    );
  }

  function openEnd() {
    flushAll();
    const st = liveState();
    if (!ui.end) ui.end = { winner: st.alive.length === 1 ? st.alive[0] : null, winType: st.alive.length === 1 ? "last" : "alt" };
    const { winner, winType } = ui.end;
    const seats = game.setup.seats;
    openModal(
      `<h2>🏁 ${t("gameOver")}</h2>
      <section class="facts"><div><b>${st.round}</b><small>${t("rounds")}</small></div><div><b>${fmtClock(Date.now() - game.setup.startedAt)}</b><small>${t("duration")}</small></div><div><b>${st.knockouts.reduce((a, b) => a + b, 0)}</b><small>${t("knockouts")}</small></div></section>
      <h3>${t("winner")}</h3><div class="chips">${seats
        .map((s, i) => `<button class="chip ${winner === i ? "on" : ""}" data-action="endWinner" data-v="${i}">${avatar(s)}${esc(s.name)}<small>${st.players[i].out ? t("out") : st.players[i].life}</small></button>`)
        .join("")}<button class="chip ${winner == null ? "on" : ""}" data-action="endWinner" data-v="">${t("noWinner")}</button></div>
      <h3>${t("winType")}</h3><div class="chips">${WIN_TYPES.map((w) => `<button class="chip ${winType === w ? "on" : ""}" data-action="endType" data-v="${w}">${t("win_" + w)}</button>`).join("")}</div>
      <div class="actions"><button class="btn" data-action="endCancel">${t("keepPlaying")}</button><button class="btn primary" data-action="endSave">${t("saveMatch")}</button></div>`,
      "small"
    );
  }

  function eliminate(seat, by, cause) {
    dispatch({ type: "elim", seat, by, cause });
    ui.panel = null;
    closeModal();
    render();
    checkEnd();
  }

  function startFrom(setupLike) {
    newGame(setupLike);
    const first = game.setup.seats[game.setup.firstSeat];
    go("game");
    toast(`🎲 ${t("goesFirst", { name: first.name })}`);
  }

  // ---------- Actions (click), changes and form submits ----------

  const A = {
    nav: (el) => go(el.dataset.to, { id: el.dataset.id }),
    closeModal: () => {
      closeModal();
      ui.end = null;
    },
    confirmYes: () => {
      const cb = confirmCb;
      confirmCb = null;
      closeModal();
      if (cb) cb();
    },

    newSetup: () => {
      const begin = () => {
        ui.setup = { seats: [], startingLife: S.settings.startingLife, quick: false, first: "random" };
        ui.swapPick = null;
        go("setup");
      };
      if (game) confirmModal(t("confirmReplaceGame"), begin, t("newGame"));
      else begin();
    },
    togglePod: (el) => {
      const su = ui.setup;
      const idx = su.seats.findIndex((s) => s.playerId === el.dataset.id);
      if (idx >= 0) su.seats.splice(idx, 1);
      else if (su.seats.length < Game.MAX_PLAYERS) su.seats.push({ playerId: el.dataset.id, deckId: defaultDeck(el.dataset.id) });
      else toast(t("maxPlayers"));
      if (su.first !== "random" && Number(su.first) >= su.seats.length) su.first = "random";
      ui.swapPick = null;
      render();
    },
    seatTap: (el) => {
      const i = Number(el.dataset.seat);
      if (ui.swapPick == null) ui.swapPick = i;
      else {
        const seats = ui.setup.seats;
        [seats[ui.swapPick], seats[i]] = [seats[i], seats[ui.swapPick]];
        ui.swapPick = null;
      }
      render();
    },
    startGame: () => {
      const su = ui.setup;
      const n = su.seats.length;
      if (n < Game.MIN_PLAYERS) return;
      const seats = su.seats.map((s) => {
        const p = Store.player(s.playerId);
        const d = su.quick ? null : Store.deck(s.deckId);
        return {
          playerId: p.id,
          name: p.name,
          color: p.color,
          avatar: p.avatar,
          deckId: d ? d.id : null,
          deckName: d ? d.name : "",
          deckVersion: d && d.version ? d.version : null,
          commanders: d ? d.commanders.filter(Boolean) : [],
          art: d && d.art ? d.art : null,
        };
      });
      const firstSeat = su.first === "random" ? random(n) : Number(su.first);
      startFrom({ startedAt: Date.now(), startingLife: clampLife(su.startingLife), seats, firstSeat, firstMode: su.first, quick: su.quick });
    },

    panel: (el) => {
      const i = Number(el.dataset.seat);
      ui.panel = ui.panel === i ? null : i;
      ui.cmdBy = {};
      render();
    },
    attrib: (el) => {
      if (!ui.attrib) return;
      const v = el.dataset.src === "" ? null : Number(el.dataset.src);
      if (ui.attrib.key) {
        const p = pending.get(ui.attrib.key);
        if (p) {
          p.ev.source = v;
          p.ev.chosen = true;
        }
      } else {
        const ev = game.events.find((e) => e.id === ui.attrib.evId);
        if (ev) ev.source = v;
      }
      ui.attrib = null;
      clearTimeout(attribTimer);
      persist();
      render();
    },
    cmd: (el) => {
      const seat = Number(el.dataset.seat);
      const from = Number(el.dataset.from);
      const idx = Number(el.dataset.idx);
      const d = Number(el.dataset.d);
      const cur = liveState().players[seat].cmd[from + ":" + idx] || 0;
      if (cur + d < 0) return;
      if (d > 0 && S.settings.sound) Sound.play();
      const by = ui.cmdBy[seat];
      queue(by == null ? { type: "cmd", seat, from, idx } : { type: "cmd", seat, from, idx, by }, d);
    },
    cmdBy: (el) => {
      ui.cmdBy[Number(el.dataset.seat)] = el.dataset.v === "" ? null : Number(el.dataset.v);
      render();
    },
    toggleFace: () => {
      S.settings.faceMe = !S.settings.faceMe;
      Store.save();
      closeModal();
      render();
    },
    lifeMode: (el) => {
      readLifeEditor();
      ui.edit.mode = el.dataset.v;
      lifeEditor();
    },
    lifeAmt: (el) => {
      readLifeEditor();
      ui.edit.amount = el.dataset.v;
      lifeEditor();
    },
    lifeSrc: (el) => {
      readLifeEditor();
      ui.edit.source = el.dataset.v === "" ? null : Number(el.dataset.v);
      lifeEditor();
    },
    lifeApply: () => {
      readLifeEditor();
      const { seat, mode, source } = ui.edit;
      const amt = parseInt(ui.edit.amount, 10);
      if (!Number.isFinite(amt) || amt < 0) return toast(t("enterNumber"));
      const life = liveState().players[seat].life;
      const delta = mode === "set" ? amt - life : mode === "gain" ? amt : -amt;
      closeModal();
      if (!delta) return;
      dispatch(delta < 0 ? { type: "life", seat, delta, source } : { type: "life", seat, delta, source: null });
    },
    poison: (el) => {
      const seat = Number(el.dataset.seat);
      const d = Number(el.dataset.d);
      if (liveState().players[seat].poison + d < 0) return;
      queue({ type: "poison", seat }, d);
    },
    tax: (el) => {
      const seat = Number(el.dataset.seat);
      const idx = Number(el.dataset.idx);
      const d = Number(el.dataset.d);
      if (liveState().players[seat].tax[idx] + d < 0) return;
      queue({ type: "tax", seat, idx }, d);
    },
    counter: (el) => {
      const seat = Number(el.dataset.seat);
      const name = el.dataset.name;
      const d = Number(el.dataset.d);
      if ((liveState().players[seat].counters[name] || 0) + d < 0) return;
      queue({ type: "counter", seat, name }, d);
    },
    flag: (el) => {
      const seat = Number(el.dataset.seat);
      const flag = el.dataset.flag;
      dispatch({ type: "flag", seat, flag, value: !liveState().players[seat][flag] });
    },
    token: (el) => {
      const seat = Number(el.dataset.seat);
      const token = el.dataset.token;
      dispatch({ type: "token", token, seat: liveState()[token] === seat ? null : seat });
    },
    tokenModal: (el) => tokenModal(el.dataset.token),
    tokenSet: (el) => {
      closeModal();
      dispatch({ type: "token", token: el.dataset.token, seat: el.dataset.seat === "" ? null : Number(el.dataset.seat) });
    },
    elimPrompt: (el) => {
      flushAll();
      const seat = Number(el.dataset.seat);
      const lethal = liveState().players[seat].lethal;
      ui.elim = { seat, cause: lethal ? lethal.cause : "combat", by: lethal && lethal.by != null && lethal.by !== seat ? lethal.by : guessKiller(seat) };
      showElim();
    },
    elimCause: (el) => {
      ui.elim.cause = el.dataset.v;
      if (el.dataset.v === "concede") ui.elim.by = null;
      showElim();
    },
    elimBy: (el) => {
      ui.elim.by = el.dataset.v === "" ? null : Number(el.dataset.v);
      showElim();
    },
    elimConfirm: () => eliminate(ui.elim.seat, ui.elim.by, ui.elim.cause),
    concede: (el) => {
      const seat = Number(el.dataset.seat);
      confirmModal(t("confirmConcede", { name: game.setup.seats[seat].name }), () => eliminate(seat, null, "concede"), t("concede"));
    },
    undo: () => {
      flushAll();
      const last = [...game.events].reverse().find((e) => !e.reverted);
      if (!last) return;
      last.reverted = true;
      ui.attrib = null;
      persist();
      render();
      toast(`↶ ${describe(last, game.setup.seats)}`);
    },
    nextTurn: () => {
      flushAll();
      const st = liveState();
      dispatch({ type: "turn", to: Game.nextAlive(st, st.active, game.setup.seats.length) });
    },
    menu: () => {
      flushAll();
      render();
      openMenu();
    },
    showLog: () => {
      flushAll();
      showLog();
    },
    logToggle: (el) => {
      const ev = game.events.find((e) => e.id === el.dataset.id);
      if (!ev) return;
      ev.reverted = !ev.reverted;
      persist();
      render();
      showLog();
    },
    noteModal: () => noteModal(),
    noteTag: (el) => {
      const ta = $("#noteText");
      ta.value = (ta.value ? ta.value.trim() + " " : "") + el.dataset.v;
      ta.focus();
    },
    noteSave: () => {
      const text = $("#noteText").value.trim();
      closeModal();
      if (text) {
        dispatch({ type: "note", text });
        toast(`📝 ${t("noteSaved")}`);
      }
    },
    reroll: () => {
      game.setup.firstSeat = random(game.setup.seats.length);
      persist();
      closeModal();
      render();
      toast(`🎲 ${t("goesFirst", { name: game.setup.seats[game.setup.firstSeat].name })}`);
    },
    endPrompt: () => {
      ui.end = null;
      openEnd();
    },
    endWinner: (el) => {
      ui.end.winner = el.dataset.v === "" ? null : Number(el.dataset.v);
      if (ui.end.winner == null) ui.end.winType = "draw";
      else if (ui.end.winType === "draw") ui.end.winType = "last";
      openEnd();
    },
    endType: (el) => {
      ui.end.winType = el.dataset.v;
      if (el.dataset.v === "draw") ui.end.winner = null;
      openEnd();
    },
    endCancel: () => {
      ui.end = null;
      closeModal();
    },
    endSave: () => {
      flushAll();
      const match = Game.buildMatch(game, { winnerSeat: ui.end.winner, winType: ui.end.winType });
      S.matches.push(match);
      Store.save();
      game = null;
      Store.saveGame(null);
      ui.end = null;
      go("match", { id: match.id });
      toast(`✅ ${t("matchSaved")}`);
    },
    restartGame: () =>
      confirmModal(
        t("confirmRestart"),
        () => {
          const prev = game.setup;
          const firstSeat = prev.firstMode === "random" ? random(prev.seats.length) : prev.firstSeat;
          startFrom({ ...prev, startedAt: Date.now(), firstSeat });
        },
        t("newGame")
      ),
    discardGame: () =>
      confirmModal(
        t("confirmDiscard"),
        () => {
          pending.forEach((p) => clearTimeout(p.timer));
          pending.clear();
          game = null;
          Store.saveGame(null);
          go("home");
        },
        t("discardGame")
      ),

    addPlayer: () => {
      const used = S.players.map((p) => p.color);
      const p = {
        id: Store.uid(),
        name: I18n.raw("newPlayer") + " " + (S.players.filter((x) => !x.guest).length + 1),
        color: COLORS.find((c) => !used.includes(c)) || COLORS[random(COLORS.length)],
        avatar: AVATARS[random(AVATARS.length)],
        guest: false,
      };
      S.players.push(p);
      Store.save();
      go("player", { id: p.id });
    },
    pColor: (el) => {
      Store.player(ui.params.id).color = el.dataset.v;
      Store.save();
      render();
    },
    pAvatar: (el) => {
      Store.player(ui.params.id).avatar = el.dataset.v;
      Store.save();
      render();
    },
    deletePlayer: (el) =>
      confirmModal(
        t("confirmDeletePlayer"),
        () => {
          S.players = S.players.filter((p) => p.id !== el.dataset.id);
          S.decks = S.decks.filter((d) => d.ownerId !== el.dataset.id);
          Store.data.players = S.players;
          Store.data.decks = S.decks;
          Store.save();
          go("players");
        },
        t("delete")
      ),
    promoteGuest: (el) => {
      Store.player(el.dataset.id).guest = false;
      Store.save();
      render();
    },
    mergeGuest: (el) => {
      const guest = Store.player(el.dataset.id);
      openModal(
        `<h2>${t("mergeX", { name: guest.name })}</h2><p class="muted small">${t("mergeHint")}</p><div class="chips">${S.players
          .filter((p) => !p.guest)
          .map((p) => `<button class="chip" data-action="mergeInto" data-guest="${guest.id}" data-target="${p.id}">${avatar(p)}${esc(p.name)}</button>`)
          .join("")}</div>`,
        "small"
      );
    },
    mergeInto: (el) => {
      Store.mergeGuest(el.dataset.guest, el.dataset.target);
      closeModal();
      render();
      toast(t("merged"));
    },
    openDeck: (el) => {
      const d = el.dataset.id ? Store.deck(el.dataset.id) : null;
      ui.deck = d
        ? { ...d, commanders: [...d.commanders], known: [...(d.known || [])], warn: "", importMsg: "" }
        : { id: null, ownerId: el.dataset.owner, name: "", commanders: [], colors: "", list: "", bracket: null, art: null, warn: "", analysis: null, versions: [], version: 0 };
      deckModal();
    },
    checkDeck: () => {
      readDeckForm();
      runCheck(ui.deck);
    },
    fixCard: (el) => {
      readDeckForm();
      fixNames(ui.deck, { [el.dataset.from]: el.dataset.to });
    },
    fixAll: () => {
      readDeckForm();
      const d = ui.deck;
      const map = {};
      for (const n of d.analysis.notFound) if (d.analysis.suggest && d.analysis.suggest[n]) map[n] = d.analysis.suggest[n].name;
      fixNames(d, map);
    },
    keepCard: (el) => {
      readDeckForm();
      const d = ui.deck;
      d.known = [...new Set([...(d.known || []), el.dataset.name])];
      runCheck(d);
    },
    unkeepCard: (el) => {
      readDeckForm();
      const d = ui.deck;
      d.known = (d.known || []).filter((n) => n.toLowerCase() !== el.dataset.name.toLowerCase());
      runCheck(d);
    },
    editCard: (el) => {
      const ta = $("#dList");
      if (!ta) return;
      const name = el.dataset.name.toLowerCase();
      const lines = ta.value.split("\n");
      let pos = 0;
      for (const line of lines) {
        if (line.toLowerCase().includes(name)) {
          ta.focus();
          ta.setSelectionRange(pos, pos + line.length);
          ta.scrollIntoView({ block: "center" });
          return;
        }
        pos += line.length + 1;
      }
      ta.focus();
    },
    pasteClipboard: async () => {
      readDeckForm();
      const d = ui.deck;
      let text = "";
      try {
        text = await navigator.clipboard.readText();
      } catch (e) {
        text = "";
      }
      if (!text.trim()) {
        const ta = $("#dList");
        if (ta) ta.focus();
        return toast(t("pasteManually"));
      }
      const parsed = Decks.parseList(text);
      if (!parsed.cards.length) return toast(t("clipboardNoDeck"));
      d.list = text;
      if (parsed.commanders.length) d.commanders = parsed.commanders.slice(0, 2);
      const id = Decks.moxfieldId(d.moxUrl);
      if (id) d.source = { type: "moxfield", id, url: "https://moxfield.com/decks/" + id };
      d.colors = "";
      d.moxStep = false;
      d.importOk = true;
      d.importMsg = t("importedN", { n: parsed.cards.reduce((sum, c) => sum + c.q, 0) });
      d.analysis = null;
      await runCheck(d);
    },
    saveDeckTxt: () => {
      readDeckForm();
      const d = ui.deck;
      const parsed = Decks.parseList(d.list);
      const commanders = d.commanders.length ? d.commanders : parsed.commanders;
      const cards = parsed.cards.slice();
      for (const c of commanders) if (!cards.some((x) => x.n.toLowerCase() === c.toLowerCase())) cards.unshift({ q: 1, n: c });
      if (!cards.length) return toast(t("needList"));
      const name = (d.name || commanders[0] || "deck").replace(/[\\/:*?"<>|]+/g, " ").trim();
      download(name + ".txt", Decks.toText(cards, commanders) + "\n");
    },
    incomingFor: (el) => {
      const inc = ui.incoming;
      if (!inc) return closeModal();
      let ownerId = el.dataset.id;
      if (!ownerId) {
        const used = S.players.map((p) => p.color);
        const p = {
          id: Store.uid(),
          name: I18n.raw("newPlayer") + " " + (S.players.filter((x) => !x.guest).length + 1),
          color: COLORS.find((c) => !used.includes(c)) || COLORS[random(COLORS.length)],
          avatar: AVATARS[random(AVATARS.length)],
          guest: false,
        };
        S.players.push(p);
        Store.save();
        ownerId = p.id;
      }
      ui.incoming = null;
      go("player", { id: ownerId });
      ui.deck = {
        id: null,
        ownerId,
        name: inc.name,
        commanders: inc.commanders.slice(0, 2),
        colors: "",
        list: Decks.toText(inc.cards, inc.commanders),
        bracket: null,
        art: null,
        warn: "",
        analysis: null,
        versions: [],
        version: 0,
        source: inc.source,
        importOk: true,
        importMsg: t("importedN", { n: inc.cards.reduce((sum, c) => sum + c.q, 0) }),
      };
      runCheck(ui.deck);
    },
    copyBookmarklet: async () => {
      try {
        await navigator.clipboard.writeText(Decks.bookmarklet(appUrl()));
        toast(t("copied"));
      } catch (e) {
        const box = $("#bmCode");
        if (box) {
          box.hidden = false;
          box.select();
        }
        toast(t("copyManually"));
      }
    },
    clearCards: () =>
      confirmModal(
        t("confirmClearCards"),
        () => {
          Store.clearCards();
          render();
        },
        t("clearCache")
      ),
    useEstimate: () => {
      readDeckForm();
      ui.deck.bracket = ui.deck.analysis.estimate.bracket;
      deckModal();
    },
    dColor: (el) => {
      readDeckForm();
      const c = el.dataset.v;
      const d = ui.deck;
      d.colors = d.colors.includes(c) ? d.colors.replace(c, "") : MANA.filter((m) => d.colors.includes(m) || m === c).join("");
      deckModal();
    },
    deckSave: () => {
      readDeckForm();
      const d = ui.deck;
      if (!d.name && !d.commanders.length) return toast(t("deckNeedsName"));
      const prev = d.id ? Store.deck(d.id) : null;
      const parsed = Decks.parseList(d.list);
      const fp = parsed.cards.length ? Decks.fingerprint(parsed.cards) : "";
      // A changed list becomes a new version; saved games keep the one played.
      let version = (prev && prev.version) || 0;
      const versions = ((prev && prev.versions) || []).slice();
      if (fp && fp !== (prev && prev.fp)) {
        version = prev && prev.fp ? version + 1 : Math.max(version, 1);
        versions.push({ v: version, at: Date.now(), list: d.list });
      }
      const deck = {
        id: d.id || Store.uid(),
        ownerId: d.ownerId,
        name: d.name || d.commanders.join(" + "),
        commanders: d.commanders,
        colors: d.colors,
        list: d.list,
        fp,
        version,
        versions: versions.slice(-20),
        bracket: d.bracket,
        art: d.art || null,
        analysis: d.analysis || null,
        source: d.source || null,
        known: d.known || [],
      };
      const idx = S.decks.findIndex((x) => x.id === deck.id);
      if (idx >= 0) S.decks[idx] = deck;
      else S.decks.push(deck);
      Store.save();
      closeModal();
      render();
    },
    deckDelete: () =>
      confirmModal(
        t("confirmDeleteDeck"),
        () => {
          Store.data.decks = S.decks = S.decks.filter((x) => x.id !== ui.deck.id);
          Store.save();
          render();
        },
        t("delete")
      ),

    rivKind: (el) => {
      ui.riv = { kind: el.dataset.v, id: null };
      render();
    },
    rivPick: (el) => {
      ui.riv.id = el.dataset.v;
      render();
    },
    seasonPick: (el) => {
      ui.season = el.dataset.v;
      render();
    },
    seasonStats: (el) => {
      ui.statsSeason = el.dataset.v;
      go("stats");
    },
    statsSeason: (el) => {
      ui.statsSeason = el.dataset.v;
      render();
    },
    shareRecap: async (el) => {
      const m = S.matches.find((x) => x.id === el.dataset.id);
      if (!m) return;
      const text = `⚔️ ${I18n.raw("appName")} · ${fmtDate(m.date)}\n\n` + Recap.recap(m, I18n.fmt).join("\n");
      if (navigator.share) {
        try {
          await navigator.share({ text });
          return;
        } catch (e) {
          if (e && e.name === "AbortError") return;
        }
      }
      window.open("https://wa.me/?text=" + encodeURIComponent(text), "_blank", "noopener");
    },
    deleteMatch: (el) =>
      confirmModal(
        t("confirmDeleteMatch"),
        () => {
          Store.data.matches = S.matches = S.matches.filter((m) => m.id !== el.dataset.id);
          Store.save();
          go("history");
        },
        t("delete")
      ),

    newManual: () => {
      ui.manual = { seats: [], winner: null, date: new Date().toISOString().slice(0, 10), rounds: "" };
      go("manual");
    },
    manToggle: (el) => {
      const mu = ui.manual;
      const idx = mu.seats.findIndex((s) => s.playerId === el.dataset.id);
      if (idx >= 0) {
        mu.seats.splice(idx, 1);
        if (mu.winner === idx) mu.winner = null;
        else if (mu.winner > idx) mu.winner--;
      } else if (mu.seats.length < Game.MAX_PLAYERS) mu.seats.push({ playerId: el.dataset.id, deckId: defaultDeck(el.dataset.id) });
      render();
    },
    manWinner: (el) => {
      const i = Number(el.dataset.seat);
      ui.manual.winner = ui.manual.winner === i ? null : i;
      render();
    },
    manSave: () => {
      const mu = ui.manual;
      const date = Date.parse(mu.date + "T12:00:00") || Date.now();
      const match = {
        id: Store.uid(),
        manual: true,
        date,
        startedAt: date,
        endedAt: date,
        durationMin: null,
        firstSeat: null,
        rounds: parseInt(mu.rounds, 10) || null,
        seats: mu.seats.map((s) => {
          const p = Store.player(s.playerId);
          const d = Store.deck(s.deckId);
          return { playerId: p.id, name: p.name, deckId: d ? d.id : null, deckName: d ? d.name : "", commanders: d ? d.commanders : [] };
        }),
        winnerSeat: mu.winner,
        winType: mu.winner == null ? "draw" : null,
        eliminations: [],
        damage: null,
        finalLife: null,
        notes: [],
        events: [],
      };
      S.matches.push(match);
      Store.save();
      ui.manual = null;
      go("match", { id: match.id });
      toast(`✅ ${t("matchSaved")}`);
    },

    exportData: () => {
      const payload = { app: "commander-tracker", version: 1, exportedAt: new Date().toISOString(), data: S, game };
      const blob = new Blob([JSON.stringify(payload, null, 1)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `commander-tracker-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
    eraseAll: () =>
      confirmModal(
        t("confirmErase"),
        () => {
          const lang = S.settings.lang;
          Store.replaceAll({ settings: { lang } });
          game = null;
          pending.clear();
          Store.saveGame(null);
          go("home");
        },
        t("eraseAll")
      ),
  };

  const C = {
    seatDeck: (el) => {
      ui.setup.seats[Number(el.dataset.seat)].deckId = el.value;
    },
    quick: (el) => {
      ui.setup.quick = el.checked;
      render();
    },
    startLife: (el) => {
      ui.setup.startingLife = clampLife(el.value);
    },
    first: (el) => {
      ui.setup.first = el.value;
    },
    pName: (el) => {
      const name = el.value.trim();
      if (!name) return;
      Store.player(ui.params.id).name = name;
      Store.save();
      render();
    },
    pAvatarCustom: (el) => {
      const v = el.value.trim();
      if (!v) return;
      Store.player(ui.params.id).avatar = v;
      Store.save();
      render();
    },
    cmdLookup: async () => {
      readDeckForm();
      const d = ui.deck;
      const names = d.commanders.slice();
      if (!names.length || !navigator.onLine) return;
      const cards = await Promise.all(names.map((n) => Decks.lookupCard(n).catch(() => null)));
      if (ui.deck !== d || !$("#dC1")) return;
      readDeckForm();
      const found = cards.filter(Boolean);
      if (!found.length) return;
      found.forEach((c, k) => {
        if (d.commanders[k] && d.commanders[k].toLowerCase() === c.name.toLowerCase()) d.commanders[k] = c.name;
      });
      d.colors = MANA.filter((m) => found.some((c) => c.ci.includes(m))).join("");
      d.art = found[0].art || d.art;
      const banned = found.filter((c) => c.legal === "banned").map((c) => c.name);
      const notCmd = found.filter((c) => !c.canLead).map((c) => c.name);
      d.warn = [banned.length ? t("bannedWarn", { names: banned.join(", ") }) : "", notCmd.length ? t("notCommanderWarn", { names: notCmd.join(", ") }) : ""].filter(Boolean).join(" ");
      deckModal();
    },
    manDeck: (el) => {
      ui.manual.seats[Number(el.dataset.seat)].deckId = el.value;
    },
    manDate: (el) => {
      ui.manual.date = el.value;
    },
    manRounds: (el) => {
      ui.manual.rounds = el.value;
    },
    lang: (el) => {
      S.settings.lang = el.value;
      Store.save();
      render();
    },
    holdStep: (el) => {
      S.settings.holdStep = Number(el.value);
      Store.save();
    },
    defaultLife: (el) => {
      S.settings.startingLife = clampLife(el.value);
      Store.save();
    },
    setToggle: (el) => {
      S.settings[el.dataset.key] = el.checked;
      Store.save();
      updateWake();
    },
    importFile: (el) => {
      const file = el.files && el.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        let obj;
        try {
          obj = JSON.parse(reader.result);
        } catch (e) {
          return toast(t("importFailed"));
        }
        const data = obj && obj.data ? obj.data : obj;
        if (!data || !Array.isArray(data.players)) return toast(t("importFailed"));
        confirmModal(
          t("confirmImport", { players: data.players.length, matches: (data.matches || []).length }),
          () => {
            Store.replaceAll(data);
            render();
            toast(t("imported"));
          },
          t("import")
        );
      };
      reader.readAsText(file);
      el.value = "";
    },
  };

  const F = {
    moxImport: async () => {
      readDeckForm();
      const d = ui.deck;
      if (!d.moxUrl) return;
      d.importing = true;
      d.importMsg = "";
      deckModal();
      try {
        const res = await Decks.importMoxfield(d.moxUrl);
        d.list = Decks.toText(res.cards, res.commanders);
        if (res.commanders.length) d.commanders = res.commanders.slice(0, 2);
        if (!d.name) d.name = res.name;
        d.source = res.source;
        d.colors = "";
        d.importOk = true;
        d.importMsg = t("importedN", { n: res.cards.reduce((sum, c) => sum + c.q, 0) });
        d.importing = false;
        await runCheck(d);
        return;
      } catch (e) {
        d.importOk = false;
        if (e.message === "blocked") {
          d.moxStep = true;
          d.importMsg = "";
        } else d.importMsg = t("mox_" + (["badUrl", "notFound", "empty"].includes(e.message) ? e.message : "blocked"));
      }
      d.importing = false;
      if (ui.deck === d) deckModal();
    },
    addGuest: (form) => {
      const input = form.querySelector("input");
      const name = input.value.trim();
      if (!name) return;
      let p = S.players.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (!p) {
        const taken = ui.setup.seats.map((s) => Store.player(s.playerId).color);
        const free = COLORS.filter((c) => !taken.includes(c));
        p = { id: Store.uid(), name, color: free.length ? free[random(free.length)] : COLORS[random(COLORS.length)], avatar: name.slice(0, 1).toUpperCase(), guest: true };
        S.players.push(p);
        Store.save();
      }
      const su = ui.setup;
      if (!su.seats.some((s) => s.playerId === p.id) && su.seats.length < Game.MAX_PLAYERS) su.seats.push({ playerId: p.id, deckId: defaultDeck(p.id) });
      render();
      const again = $("#guestName");
      if (again) again.focus();
    },
    addCounter: (form) => {
      const name = form.querySelector("input").value.trim();
      if (!name) return;
      if (!QUICK_COUNTERS.includes(name)) {
        S.settings.recentCounters = [name, ...(S.settings.recentCounters || []).filter((c) => c !== name)].slice(0, 12);
        Store.save();
      }
      queue({ type: "counter", seat: Number(form.dataset.seat), name }, 1);
    },
  };

  function defaultDeck(playerId) {
    for (let k = S.matches.length - 1; k >= 0; k--) {
      const s = S.matches[k].seats.find((x) => x.playerId === playerId);
      if (s && s.deckId && Store.deck(s.deckId)) return s.deckId;
    }
    const d = Store.decksOf(playerId)[0];
    return d ? d.id : "";
  }

  // ---------- Scryfall (online only; the tracker never depends on it) ----------

  let acTimer = null;
  let acSeq = 0;
  async function autocomplete(q) {
    const seq = ++acSeq;
    try {
      const names = await Decks.autocomplete(q);
      const dl = $("#cmdList");
      if (seq === acSeq && dl) dl.innerHTML = names.map((name) => `<option value="${esc(name)}">`).join("");
    } catch (e) {
      /* offline: typing a name by hand still works */
    }
  }

  // ---------- Keep-awake ----------

  async function updateWake() {
    const want = ui.view === "game" && S.settings.keepAwake && document.visibilityState === "visible";
    if (want && !wakeLock && "wakeLock" in navigator) {
      try {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => {
          wakeLock = null;
        });
      } catch (e) {
        wakeLock = null;
      }
    } else if (!want && wakeLock) {
      wakeLock.release().catch(() => {});
      wakeLock = null;
    }
  }

  // ---------- Wiring ----------

  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el || el.disabled) return;
    const fn = A[el.dataset.action];
    if (!fn) return;
    e.preventDefault();
    fn(el, e);
  });
  document.addEventListener("change", (e) => {
    const el = e.target.closest("[data-change]");
    if (el && C[el.dataset.change]) C[el.dataset.change](el);
  });
  document.addEventListener("submit", (e) => {
    const form = e.target.closest("[data-submit]");
    if (!form) return;
    e.preventDefault();
    F[form.dataset.submit](form);
  });
  document.addEventListener("input", (e) => {
    if (!e.target.matches("[data-scry]")) return;
    clearTimeout(acTimer);
    const q = e.target.value.trim();
    if (q.length >= 2) acTimer = setTimeout(() => autocomplete(q), 250);
  });

  // Life taps respond on pointerdown with ±1. Holding the outer part of a tile
  // jumps by the long-press step (10 by default) and repeats; holding next to
  // the number opens the life editor instead.
  let hold = null;
  function stopHold() {
    if (hold) clearTimeout(hold.timer);
    hold = null;
  }
  function lifeTap(seat, d) {
    if (liveState().players[seat].out) return false;
    queue({ type: "life", seat, source: null }, d);
    return true;
  }
  function buzz() {
    if (navigator.vibrate) navigator.vibrate(15);
  }
  app.addEventListener("pointerdown", (e) => {
    const zone = e.target.closest("[data-life]");
    if (!zone) return;
    e.preventDefault();
    stopHold();
    const seat = Number(zone.dataset.seat);
    const d = Number(zone.dataset.life);
    if (!lifeTap(seat, d)) return;
    const step = Number(S.settings.holdStep) || 10;
    hold = {
      timer: setTimeout(() => {
        buzz();
        if (zone.dataset.hold === "edit") {
          lifeTap(seat, -d); // take back the tap that started the press
          stopHold();
          openLifeEditor(seat);
          return;
        }
        lifeTap(seat, d * (step - 1)); // the first tap already counted 1
        const repeat = () => {
          if (!hold) return;
          buzz();
          lifeTap(seat, d * step);
          hold.timer = setTimeout(repeat, 650);
        };
        if (hold) hold.timer = setTimeout(repeat, 650);
      }, 450),
    };
  });
  window.addEventListener("pointerup", stopHold);
  window.addEventListener("pointercancel", stopHold);
  window.addEventListener("blur", stopHold);
  app.addEventListener("contextmenu", (e) => {
    if (ui.view === "game") e.preventDefault();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && game) {
      flushAll();
      persist();
    }
    updateWake();
  });
  window.addEventListener("pagehide", () => {
    if (game) persist();
  });

  let wasLandscape = isLandscape();
  window.addEventListener("resize", () => {
    if (ui.view === "game" && isLandscape() !== wasLandscape) render();
    wasLandscape = isLandscape();
  });

  setInterval(() => {
    const el = document.getElementById("turnTimer");
    if (el && game) el.textContent = fmtClock(Date.now() - liveState().turnStartedAt);
  }, 1000);

  restoreGame();
  ui.view = game ? "game" : "home";
  render();
  updateWake();
  takeFragment();
  window.addEventListener("hashchange", takeFragment);

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
